"""ToDo desktop UI."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from PySide6.QtCore import QEvent, QObject, QSize, Qt, Signal
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from dates import day_after, day_start_epoch, local_today
from exceptions import AMToDoError
from services import TodoService
from services.uow import UnitOfWork
from ui.settings import DEFAULT_UI_SETTINGS, TYPOGRAPHY, UISettings

if TYPE_CHECKING:
    from models import Todo
    from services import ApplicationContext

_ICON_COMPLETE = QIcon(str(Path(__file__).parent / "assets" / "complete.svg"))
_ICON_UNCOMPLETE = QIcon(str(Path(__file__).parent / "assets" / "uncomplete.svg"))
_ICON_LEFT = QIcon(str(Path(__file__).parent / "assets" / "left.svg"))
_ICON_RIGHT = QIcon(str(Path(__file__).parent / "assets" / "right.svg"))
_ICON_TODAY = QIcon(str(Path(__file__).parent / "assets" / "ToToday.svg"))


WEEKDAYS_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


class _EditFilter(QObject):
    """Event filter: double-click enters edit mode, Enter/focus-out exits."""

    def __init__(
        self,
        line_edit: QLineEdit,
        on_enter: object,
        on_exit: object,
    ) -> None:
        super().__init__()
        self._line_edit = line_edit
        self._on_enter = on_enter
        self._on_exit = on_exit

    def eventFilter(self, obj: QObject, event: QEvent) -> bool:
        if obj is self._line_edit:
            if event.type() == QEvent.Type.MouseButtonDblClick:
                self._on_enter()
                return True
            if event.type() == QEvent.Type.KeyPress:
                key = event.key()
                if key in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
                    self._on_exit()
                    return True
                if key == Qt.Key.Key_Escape:
                    self._on_exit()
                    return True
            if event.type() == QEvent.Type.FocusOut:
                self._on_exit()
                return False
        return super().eventFilter(obj, event)


class CalendarDayCell(QFrame):
    """Clickable calendar day cell built from separate labels."""

    clicked = Signal(date)

    def __init__(self, value: date, today: date) -> None:
        super().__init__()
        self._value = value
        self._selected = False
        self.setObjectName("calendarDay")
        self.setProperty("selected", "false")
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

        weekday_label = QLabel(WEEKDAYS_ZH[value.weekday()])
        weekday_label.setObjectName("weekdayLabel")
        weekday_label.setFont(TYPOGRAPHY.subheading.to_qfont())
        weekday_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        date_label = QLabel(str(value.day))
        date_label.setObjectName("dateLabel")
        date_label.setFont(TYPOGRAPHY.heading.to_qfont())
        date_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        if value == today:
            date_label.setProperty("today", "true")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(6, 8, 6, 8)
        layout.setSpacing(4)
        layout.addWidget(weekday_label)
        layout.addWidget(date_label)

    def mousePressEvent(self, event) -> None:  # noqa: ANN001
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit(self._value)
        super().mousePressEvent(event)

    def set_selected(self, selected: bool) -> None:
        """Update selected visual state."""

        self._selected = selected
        self.setProperty("selected", "true" if selected else "false")
        self.style().unpolish(self)
        self.style().polish(self)


class TodoView(QWidget):
    """Human-facing calendar view for daily ToDo items."""

    def __init__(
        self,
        context: ApplicationContext,
        settings: UISettings = DEFAULT_UI_SETTINGS,
    ) -> None:
        super().__init__()
        self._context = context
        self._settings = settings
        self._context.database.create_schema()

        today = local_today(self._context.clock, self._settings.timezone)
        self._selected_date = today
        self._week_start = self._week_start_for(today)
        self._day_cells: dict[date, CalendarDayCell] = {}

        self._calendar_layout = QHBoxLayout()
        self._month_label = QPushButton()
        self._todo_list_layout = QVBoxLayout()
        self._empty_label = QLabel("这一天还没有 ToDo")
        self._add_button: QPushButton | None = None

        self._setup_widgets()
        self._rebuild_calendar()
        self.refresh()

    def refresh(self) -> None:
        """Refresh tasks for the selected local day."""

        try:
            start_at, end_at = self._selected_day_range()
            with UnitOfWork(self._context.database) as uow:
                service = TodoService(uow.todos, self._context.clock, uow.todo_model)
                todos = service.list_between(start_at, end_at)

            self._fill_list(todos)
        except AMToDoError as exc:
            self._show_error(exc)

    def _setup_widgets(self) -> None:
        self.setStyleSheet(
            """
            QWidget {
                background: #f3f0eb;
                color: #2d2a26;
            }
            QPushButton#monthLabel {
                background: transparent;
                color: #faf7f2;
                border: 0;
                border-radius: 8px;
                padding: 6px 16px;
            }
            QPushButton#monthLabel:hover {
                background: rgba(250, 247, 242, 0.12);
                color: #f5d78c;
            }
            QLabel#emptyState {
                color: #9c958d;
                padding: 36px 8px;
            }
            QFrame#todoItem {
                background: #faf7f2;
                border: 1px solid #e5e0d8;
                border-radius: 10px;
                margin: 1px 0;
            }
            QFrame#todoItem:hover {
                border: 1px solid #d4cdc2;
            }
            QFrame#todoItem[completed="true"] {
                background: #ece7e0;
                border: 1px solid #e5e0d8;
            }
            QFrame#calendarDay {
                background: transparent;
                color: #faf7f2;
                border: 0;
                border-radius: 6px;
                min-height: 82px;
            }
            QFrame#calendarDay[selected="true"] {
                background-color: #e07b3c;
                border-radius: 6px;
            }
            QFrame#calendarDay:hover {
                background-color: #179b8c;
                border-radius: 6px;
            }
            QLabel#weekdayLabel {
                background: transparent;
                color: #faf7f2;
            }
            QLabel#dateLabel {
                background: transparent;
                color: #faf7f2;
            }
            QLabel#dateLabel[today="true"] {
                color: #f5d78c;
            }
            QPushButton#completeButton {
                background: transparent;
                border: 0;
                min-width: 40px;
                max-width: 40px;
                min-height: 40px;
                max-height: 40px;
                padding: 0;
            }
            QPushButton#completeButton:hover {
                background: rgba(16, 185, 129, 0.1);
                border-radius: 8px;
            }
            QPushButton#doneButton {
                background: transparent;
                border: 0;
                min-width: 40px;
                max-width: 40px;
                min-height: 40px;
                max-height: 40px;
                padding: 0;
            }
            QPushButton#doneButton:hover {
                background: rgba(148, 163, 184, 0.12);
                border-radius: 8px;
            }
            QLineEdit#todoTitle {
                background: transparent;
                border: 1px solid transparent;
                border-radius: 6px;
                padding: 4px 8px;
                color: #2d2a26;
            }
            QLineEdit#todoTitle:hover {
                background: rgba(224, 123, 60, 0.06);
                border: 1px solid #e0d8cc;
            }
            QLineEdit#todoTitle:focus {
                background: #ffffff;
                border: 1px solid #e07b3c;
            }
            QLineEdit#todoTitle[editMode="true"] {
                background: #ffffff;
                border: 1px solid #e07b3c;
            }
            QPushButton#addTodoButton {
                background: transparent;
                color: #9c958d;
                border: 2px dashed #d4cdc2;
                border-radius: 10px;
                padding: 10px 0;
                margin: 2px 0;
            }
            QPushButton#addTodoButton:hover {
                background: rgba(224, 123, 60, 0.06);
                color: #e07b3c;
                border: 2px dashed #e07b3c;
            }
            QPushButton#addTodoButton:pressed {
                background: rgba(224, 123, 60, 0.12);
                color: #c96a2a;
            }
            QScrollBar:vertical {
                background: transparent;
                width: 8px;
                margin: 0;
            }
            QScrollBar::handle:vertical {
                background: #d4cdc2;
                border-radius: 4px;
                min-height: 32px;
            }
            QScrollBar::handle:vertical:hover {
                background: #b8b0a5;
            }
            QScrollBar::handle:vertical:pressed {
                background: #9c958d;
            }
            QScrollBar::add-line:vertical,
            QScrollBar::sub-line:vertical {
                height: 0;
                border: none;
            }
            QScrollBar::add-page:vertical,
            QScrollBar::sub-page:vertical {
                background: transparent;
            }
            """
        )

        self._month_label.setObjectName("monthLabel")
        self._month_label.setFont(TYPOGRAPHY.display.to_qfont())
        self._month_label.setCursor(Qt.CursorShape.PointingHandCursor)
        self._empty_label.setObjectName("emptyState")
        self._empty_label.setFont(TYPOGRAPHY.body_small.to_qfont())
        self._empty_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        list_widget = QWidget()
        self._todo_list_layout.setContentsMargins(18, 10, 18, 18)
        self._todo_list_layout.setSpacing(2)
        self._todo_list_layout.addStretch(1)
        list_widget.setLayout(self._todo_list_layout)

        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setFrameShape(QFrame.Shape.NoFrame)
        scroll_area.setWidget(list_widget)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self._calendar_widget())
        layout.addWidget(scroll_area, stretch=1)

    def _calendar_widget(self) -> QWidget:
        frame = QFrame()
        frame.setObjectName("calendarStrip")
        frame.setStyleSheet(
            """
            QFrame#calendarStrip {
                background-color: #1a7f72;
            }
            QPushButton#calendarNav {
                background: transparent;
                color: #faf7f2;
                border: 0;
                padding: 4px 6px;
                min-height: 82px;
                min-width: 36px;
                border-radius: 6px;
            }
            QPushButton#calendarNav:hover {
                background-color: #179b8c;
            }
            """
        )

        button_font = TYPOGRAPHY.button.to_qfont()
        previous_button = QPushButton()
        previous_button.setObjectName("calendarNav")
        previous_button.setFont(button_font)
        previous_button.setIcon(_ICON_LEFT)
        previous_button.setIconSize(QSize(40, 40))
        next_button = QPushButton()
        next_button.setObjectName("calendarNav")
        next_button.setFont(button_font)
        next_button.setIcon(_ICON_RIGHT)
        next_button.setIconSize(QSize(40, 40))
        today_button = QPushButton()
        today_button.setObjectName("calendarNav")
        today_button.setFont(button_font)
        today_button.setIcon(_ICON_TODAY)
        today_button.setIconSize(QSize(40, 40))

        previous_button.clicked.connect(lambda: self._shift_week(-self._settings.calendar_days))
        next_button.clicked.connect(lambda: self._shift_week(self._settings.calendar_days))
        today_button.clicked.connect(self._select_today)

        month_row = QHBoxLayout()
        month_row.setContentsMargins(10, 4, 10, 0)
        month_row.addStretch(1)
        month_row.addWidget(self._month_label)
        month_row.addStretch(1)

        day_row = QHBoxLayout()
        day_row.setContentsMargins(10, 4, 10, 10)
        day_row.setSpacing(8)
        day_row.addWidget(previous_button)
        day_row.addLayout(self._calendar_layout, stretch=1)
        day_row.addWidget(next_button)
        day_row.addWidget(today_button)

        layout = QVBoxLayout(frame)
        layout.setContentsMargins(0, 8, 0, 0)
        layout.setSpacing(4)
        layout.addLayout(month_row)
        layout.addLayout(day_row)
        return frame

    def _rebuild_calendar(self) -> None:
        while self._calendar_layout.count():
            item = self._calendar_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()

        self._day_cells.clear()
        today = local_today(self._context.clock, self._settings.timezone)
        for offset in range(self._settings.calendar_days):
            current = self._week_start + timedelta(days=offset)
            cell = CalendarDayCell(current, today)
            cell.clicked.connect(self._select_date)
            self._calendar_layout.addWidget(cell)
            self._day_cells[current] = cell

        self._sync_day_selection()

    def _select_date(self, value: date) -> None:
        self._selected_date = value
        visible_end = self._week_start + timedelta(days=self._settings.calendar_days)
        if not (self._week_start <= value < visible_end):
            self._week_start = self._week_start_for(value)
            self._rebuild_calendar()
        self._sync_day_selection()
        self.refresh()

    def _select_today(self) -> None:
        self._select_date(local_today(self._context.clock, self._settings.timezone))

    def _shift_week(self, days: int) -> None:
        self._week_start += timedelta(days=days)
        self._selected_date = self._week_start
        self._rebuild_calendar()
        self.refresh()

    def _sync_day_selection(self) -> None:
        self._month_label.setText(f"{self._selected_date.year}年{self._selected_date.month}月")
        for value, cell in self._day_cells.items():
            cell.set_selected(value == self._selected_date)

    def _fill_list(self, todos: list[Todo]) -> None:
        self._clear_todo_items()

        if not todos:
            self._todo_list_layout.insertWidget(0, self._empty_label)
            self._ensure_add_button()
            return

        self._empty_label.setParent(None)
        for todo in todos:
            self._todo_list_layout.insertWidget(
                self._todo_list_layout.count() - 1,
                self._todo_item_widget(todo),
            )
        self._ensure_add_button()

    def _todo_item_widget(self, todo: Todo) -> QWidget:
        frame = QFrame()
        frame.setObjectName("todoItem")
        frame.setProperty("todo_id", todo.id)
        frame.setProperty("completed", "true" if todo.completed else "false")

        title_edit = QLineEdit(todo.title)
        title_edit.setObjectName("todoTitle")
        title_edit.setFont(TYPOGRAPHY.body.to_qfont())
        title_edit.setReadOnly(True)
        title_edit.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        title_edit.setCursorPosition(0)

        def enter_edit_mode() -> None:
            title_edit.setReadOnly(False)
            title_edit.setProperty("editMode", "true")
            title_edit.style().unpolish(title_edit)
            title_edit.style().polish(title_edit)
            title_edit.selectAll()
            title_edit.setFocus()

        def exit_edit_mode() -> None:
            title_edit.setReadOnly(True)
            title_edit.setProperty("editMode", "false")
            title_edit.style().unpolish(title_edit)
            title_edit.style().polish(title_edit)
            title_edit.setCursorPosition(0)
            # TODO: implement title-change callback

        edit_filter = _EditFilter(title_edit, enter_edit_mode, exit_edit_mode)
        title_edit._edit_filter = edit_filter  # keep alive
        title_edit.installEventFilter(edit_filter)

        if todo.completed:
            font = title_edit.font()
            font.setStrikeOut(True)
            title_edit.setFont(font)
            title_edit.setStyleSheet("color: #9c958d; background: transparent;")

        button = QPushButton()
        button.setIcon(_ICON_COMPLETE if todo.completed else _ICON_UNCOMPLETE)
        button.setIconSize(QSize(36, 36))
        button.setObjectName("doneButton" if todo.completed else "completeButton")
        button.clicked.connect(
            lambda _checked=False, todo_id=todo.id: self._toggle_complete(todo_id)
        )

        layout = QHBoxLayout(frame)
        layout.setContentsMargins(10, 4, 10, 4)
        layout.setSpacing(10)
        layout.addWidget(button)
        layout.addWidget(title_edit)
        return frame

    def _toggle_complete(self, todo_id: int) -> None:
        frame = self._find_todo_frame(todo_id)
        if frame is None:
            return
        completed = frame.property("completed") == "true"
        try:
            with UnitOfWork(self._context.database) as uow:
                service = TodoService(uow.todos, self._context.clock, uow.todo_model)
                if completed:
                    service.reopen(todo_id)
                else:
                    service.complete(todo_id)
            self._update_todo_item(todo_id, not completed)
        except AMToDoError as exc:
            self._show_error(exc)

    def _update_todo_item(self, todo_id: int, completed: bool) -> None:
        frame = self._find_todo_frame(todo_id)
        if frame is None:
            self.refresh()
            return

        frame.setProperty("completed", "true" if completed else "false")
        frame.style().unpolish(frame)
        frame.style().polish(frame)

        title = frame.findChild(QLineEdit)
        if title is not None:
            font = title.font()
            font.setStrikeOut(completed)
            title.setFont(font)
            if completed:
                title.setStyleSheet("color: #9c958d; background: transparent;")
            else:
                title.setStyleSheet("background: transparent;")

        button = frame.findChild(QPushButton)
        if button is not None:
            button.setIcon(_ICON_COMPLETE if completed else _ICON_UNCOMPLETE)
            button.setObjectName("doneButton" if completed else "completeButton")
            button.style().unpolish(button)
            button.style().polish(button)

    def _find_todo_frame(self, todo_id: int) -> QFrame | None:
        for i in range(self._todo_list_layout.count()):
            widget = self._todo_list_layout.itemAt(i).widget()
            if widget is not None and widget.property("todo_id") == todo_id:
                return widget
        return None

    def _clear_todo_items(self) -> None:
        self._add_button = None
        while self._todo_list_layout.count() > 1:
            item = self._todo_list_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.setParent(None)
                if widget is not self._empty_label and widget is not self._add_button:
                    widget.deleteLater()

    def _ensure_add_button(self) -> None:
        if self._add_button is not None:
            return
        self._add_button = QPushButton("+  添加待办")
        self._add_button.setObjectName("addTodoButton")
        self._add_button.setFont(TYPOGRAPHY.button.to_qfont())
        self._add_button.setCursor(Qt.CursorShape.PointingHandCursor)
        self._add_button.clicked.connect(self._add_todo)
        self._todo_list_layout.insertWidget(
            self._todo_list_layout.count() - 1,
            self._add_button,
        )

    def _add_todo(self) -> None:
        pass

    def _week_start_for(self, value: date) -> date:
        delta = (value.weekday() - self._settings.week_start) % 7
        return value - timedelta(days=delta)

    def _selected_day_range(self) -> tuple[int, int]:
        return (
            day_start_epoch(self._selected_date, self._settings.timezone),
            day_start_epoch(day_after(self._selected_date, 1), self._settings.timezone),
        )

    def _show_error(self, exc: AMToDoError) -> None:
        QMessageBox.warning(self, "AMToDo", str(exc))
