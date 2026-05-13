"""Desktop UI entry point."""

from __future__ import annotations

import sys
from ctypes import byref, c_int, sizeof, windll, wintypes
from pathlib import Path

from PySide6.QtCore import QEvent, QPoint, QRect, Qt
from PySide6.QtGui import QCloseEvent, QIcon, QMouseEvent
from PySide6.QtWidgets import (
    QApplication,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMenu,
    QPushButton,
    QSystemTrayIcon,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from services import create_application_context
from ui.schedule_view import ScheduleView
from ui.todo_view import TodoView

_ASSETS = Path(__file__).resolve().parent / "assets"
ICON_APP = QIcon(str(_ASSETS / "app.svg"))
ICON_CLOSE = QIcon(str(_ASSETS / "close.svg"))
ICON_MAXIMUM = QIcon(str(_ASSETS / "maximum.svg"))
ICON_MINIMUM = QIcon(str(_ASSETS / "minimum.svg"))
ICON_WINDOWLIZE = QIcon(str(_ASSETS / "windowlize.svg"))

_TITLEBAR_HEIGHT = 46
_BORDER_WIDTH = 7
_WINDOW_RADIUS = 12

_WM_NCHITTEST = 0x0084
_HTCLIENT = 1
_HTCAPTION = 2
_HTLEFT = 10
_HTRIGHT = 11
_HTTOP = 12
_HTBOTTOM = 15

_DWMWA_WINDOW_CORNER_PREFERENCE = 33
_DWMWCP_DEFAULT = 0
_DWMWCP_ROUND = 2


class TitleBar(QWidget):
    """NetEase-style compact custom title bar."""

    def __init__(self, parent: MainWindow) -> None:
        super().__init__(parent)
        self._main = parent
        self.setObjectName("titleBar")
        self.setFixedHeight(_TITLEBAR_HEIGHT)

        title = QLabel("AMToDo")
        title.setObjectName("titleBarTitle")

        self._btn_min = self._make_button(ICON_MINIMUM, "minButton")
        self._btn_max = self._make_button(ICON_MAXIMUM, "maxButton")
        self._btn_close = self._make_button(ICON_CLOSE, "closeButton")

        self._btn_min.clicked.connect(parent.showMinimized)
        self._btn_max.clicked.connect(parent.toggle_maximize)
        self._btn_close.clicked.connect(parent.hide_to_tray)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 0, 8, 0)
        layout.setSpacing(4)
        layout.addWidget(title)
        layout.addStretch(1)
        layout.addWidget(self._btn_min)
        layout.addWidget(self._btn_max)
        layout.addWidget(self._btn_close)

        self.setStyleSheet("""
            QWidget#titleBar {
                background: #1f1f1f;
                border-top-left-radius: 12px;
                border-top-right-radius: 12px;
            }
            QLabel#titleBarTitle {
                background: transparent;
                color: #f7f3ee;
                font-size: 13pt;
                font-weight: 600;
            }
            QPushButton#minButton,
            QPushButton#maxButton,
            QPushButton#closeButton {
                background: transparent;
                border: 0;
                border-radius: 8px;
                min-width: 36px;
                max-width: 36px;
                min-height: 30px;
                max-height: 30px;
                padding: 0;
            }
            QPushButton#minButton:hover,
            QPushButton#maxButton:hover {
                background: rgba(255, 255, 255, 0.10);
            }
            QPushButton#closeButton:hover {
                background: #c62f2f;
            }
        """)

    def set_maximized_state(self, maximized: bool) -> None:
        self._btn_max.setIcon(ICON_WINDOWLIZE if maximized else ICON_MAXIMUM)

    def button_rects(self) -> list[QRect]:
        """Return title-bar button rects in MainWindow coordinates."""

        return [
            self._to_main_rect(self._btn_min),
            self._to_main_rect(self._btn_max),
            self._to_main_rect(self._btn_close),
        ]

    def mouseDoubleClickEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._main.toggle_maximize()
            event.accept()
            return
        super().mouseDoubleClickEvent(event)

    @staticmethod
    def _make_button(icon: QIcon, name: str) -> QPushButton:
        button = QPushButton()
        button.setObjectName(name)
        button.setIcon(icon)
        button.setIconSize(button.iconSize().scaled(16, 16, Qt.AspectRatioMode.KeepAspectRatio))
        return button

    def _to_main_rect(self, widget: QWidget) -> QRect:
        top_left = widget.mapTo(self._main, QPoint(0, 0))
        return QRect(top_left, widget.size())


class MainWindow(QMainWindow):
    """Frameless rounded window with native Windows resize/move hit testing."""

    def __init__(self, app: QApplication) -> None:
        super().__init__()
        self._app = app
        self._context = create_application_context()

        self.setWindowTitle("AMToDo")
        self.setWindowIcon(ICON_APP)
        self.setWindowFlags(Qt.WindowType.Window | Qt.WindowType.FramelessWindowHint)
        self.resize(1080, 720)
        self.setMinimumSize(680, 460)
        self._restore_geometry: QRect | None = None

        self._title_bar = TitleBar(self)
        self._container = QFrame()
        self._container.setObjectName("windowContainer")

        tabs = QTabWidget()
        tabs.setObjectName("mainTabs")
        tabs.addTab(TodoView(self._context), "ToDo")
        tabs.addTab(ScheduleView(self._context), "Schedule")

        container_layout = QVBoxLayout(self._container)
        container_layout.setContentsMargins(0, 0, 0, 0)
        container_layout.setSpacing(0)
        container_layout.addWidget(self._title_bar)
        container_layout.addWidget(tabs, stretch=1)

        root = QWidget()
        root_layout = QVBoxLayout(root)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)
        root_layout.addWidget(self._container)
        self.setCentralWidget(root)

        self._apply_styles()
        self._setup_tray()

    def closeEvent(self, event: QCloseEvent) -> None:
        """Hide to tray on close, preserving the existing app behavior."""

        event.ignore()
        self.hide_to_tray()

    def changeEvent(self, event: QEvent) -> None:
        if event.type() == QEvent.Type.WindowStateChange:
            self._sync_window_state()
        super().changeEvent(event)

    def showEvent(self, event: QEvent) -> None:
        super().showEvent(event)
        self._apply_native_corner_preference()

    def nativeEvent(self, event_type: bytes | str, message: int) -> tuple[bool, int]:
        """Use native hit testing for smooth four-edge resize and title dragging."""

        event_name = event_type.decode() if isinstance(event_type, bytes) else str(event_type)
        if event_name not in {"windows_generic_MSG", "windows_dispatcher_MSG"}:
            return super().nativeEvent(event_type, message)

        msg = wintypes.MSG.from_address(int(message))
        if msg.message != _WM_NCHITTEST:
            return super().nativeEvent(event_type, message)

        hit = self._hit_test(self.mapFromGlobal(_global_point_from_lparam(msg.lParam)))
        if hit != _HTCLIENT:
            return True, hit
        return super().nativeEvent(event_type, message)

    def toggle_maximize(self) -> None:
        if self._is_effectively_maximized():
            if self._restore_geometry is not None:
                self.setGeometry(self._restore_geometry)
            else:
                self.showNormal()
        else:
            self._restore_geometry = self.geometry()
            screen = self.screen()
            if screen is not None:
                self.setGeometry(screen.availableGeometry())
            else:
                self.showMaximized()
        self._sync_window_state()

    def hide_to_tray(self) -> None:
        self.hide()

    def _setup_tray(self) -> None:
        self._tray = QSystemTrayIcon(self)
        self._tray.setIcon(ICON_APP)
        self._tray.setToolTip("AMToDo")

        menu = QMenu()
        show_action = menu.addAction("显示")
        show_action.triggered.connect(self._show_from_tray)
        menu.addSeparator()
        quit_action = menu.addAction("退出")
        quit_action.triggered.connect(self._app.quit)

        self._tray.setContextMenu(menu)
        self._tray.activated.connect(self._on_tray_activated)
        self._tray.show()

    def _show_from_tray(self) -> None:
        self.show()
        self.raise_()
        self.activateWindow()

    def _on_tray_activated(self, reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason == QSystemTrayIcon.ActivationReason.DoubleClick:
            self._show_from_tray()

    def _hit_test(self, pos: QPoint) -> int:
        if self._is_effectively_maximized():
            return _HTCLIENT

        rect = self.rect()
        if pos.x() <= _BORDER_WIDTH:
            return _HTLEFT
        if pos.x() >= rect.width() - _BORDER_WIDTH:
            return _HTRIGHT
        if pos.y() <= _BORDER_WIDTH:
            return _HTTOP
        if pos.y() >= rect.height() - _BORDER_WIDTH:
            return _HTBOTTOM

        if pos.y() <= _TITLEBAR_HEIGHT and not self._is_title_button_at(pos):
            return _HTCAPTION

        return _HTCLIENT

    def _is_title_button_at(self, pos: QPoint) -> bool:
        return any(rect.contains(pos) for rect in self._title_bar.button_rects())

    def _is_effectively_maximized(self) -> bool:
        screen = self.screen()
        if screen is None:
            return False
        return self.geometry() == screen.availableGeometry()

    def _sync_window_state(self) -> None:
        maximized = self._is_effectively_maximized()
        self._title_bar.set_maximized_state(maximized)
        self._update_container_style(maximized)
        self._apply_native_corner_preference()

    def _apply_styles(self) -> None:
        self._update_container_style(False)
        self.setStyleSheet("""
            QMainWindow {
                background: #f3f0eb;
            }
            QTabWidget#mainTabs::pane {
                border: 0;
                background: #f3f0eb;
            }
            QTabWidget#mainTabs {
                background: #f3f0eb;
            }
            QTabBar::tab {
                background: #e8e3da;
                color: #6b6560;
                border: 0;
                padding: 8px 24px;
                font-size: 13pt;
                font-weight: 600;
            }
            QTabBar::tab:selected {
                background: #f3f0eb;
                color: #c62f2f;
            }
            QTabBar::tab:hover:!selected {
                color: #2d2a26;
            }
        """)

    def _update_container_style(self, maximized: bool) -> None:
        radius = "0px" if maximized else f"{_WINDOW_RADIUS}px"
        self._container.setStyleSheet(f"""
            QFrame#windowContainer {{
                background: #f3f0eb;
                border-radius: {radius};
            }}
            QWidget#titleBar {{
                border-top-left-radius: {radius};
                border-top-right-radius: {radius};
            }}
        """)

    def _apply_native_corner_preference(self) -> None:
        preference = _DWMWCP_DEFAULT if self._is_effectively_maximized() else _DWMWCP_ROUND
        value = c_int(preference)
        try:
            windll.dwmapi.DwmSetWindowAttribute(
                int(self.winId()),
                _DWMWA_WINDOW_CORNER_PREFERENCE,
                byref(value),
                sizeof(value),
            )
        except (AttributeError, OSError):
            return


def _global_point_from_lparam(value: int) -> QPoint:
    return QPoint(_signed_low_word(value), _signed_high_word(value))


def _signed_low_word(value: int) -> int:
    result = value & 0xFFFF
    return result - 0x10000 if result & 0x8000 else result


def _signed_high_word(value: int) -> int:
    result = (value >> 16) & 0xFFFF
    return result - 0x10000 if result & 0x8000 else result


def main() -> int:
    """Run the desktop application."""

    qt_app = QApplication(sys.argv)
    qt_app.setQuitOnLastWindowClosed(False)
    window = MainWindow(qt_app)
    window.show()
    return qt_app.exec()
