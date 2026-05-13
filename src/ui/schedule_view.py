"""Schedule desktop UI skeleton."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFrame,
    QGridLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from clock import epoch_to_datetime
from dates import day_after, day_start_epoch, local_today
from exceptions import AMToDoError
from services import ScheduleService
from services.uow import UnitOfWork
from ui.settings import DEFAULT_UI_SETTINGS, TYPOGRAPHY, UISettings

if TYPE_CHECKING:
    from models import Schedule
    from services import ApplicationContext


WEEKDAYS_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


class ScheduleView(QWidget):
    """Human-facing timetable view for fixed time-window schedules."""

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
        self._week_start = self._week_start_for(today)
        self._grid = QGridLayout()

        self._setup_widgets()
        self.refresh()

    def refresh(self) -> None:
        """Reload schedules in the visible date range."""

        try:
            visible_start = day_start_epoch(self._week_start, self._settings.timezone)
            visible_end = day_start_epoch(
                day_after(self._week_start, self._settings.calendar_days),
                self._settings.timezone,
            )
            with UnitOfWork(self._context.database) as uow:
                service = ScheduleService(uow.schedules, self._context.clock, uow.schedule_model)
                schedules = service.list_between(visible_start, visible_end)

            self._rebuild_grid(schedules)
        except AMToDoError as exc:
            self._show_error(exc)

    def _setup_widgets(self) -> None:
        self.setStyleSheet(
            """
            QWidget {
                background: #f3f0eb;
                color: #2d2a26;
            }
            QLabel#dayHeader {
                background: #1a7f72;
                color: #faf7f2;
                border-radius: 8px;
                padding: 8px 6px;
            }
            QLabel#timeLabel {
                color: #7c746b;
                padding-right: 8px;
            }
            QFrame#timeCell {
                background: #faf7f2;
                border-left: 1px solid #e5e0d8;
                border-top: 1px solid #e5e0d8;
            }
            QPushButton#scheduleBlock {
                background: #e07b3c;
                color: #fffaf3;
                border: 0;
                border-radius: 8px;
                padding: 6px 8px;
                text-align: left;
            }
            QPushButton#scheduleBlock:hover {
                background: #c96a2a;
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

        grid_widget = QWidget()
        self._grid.setContentsMargins(14, 14, 14, 14)
        self._grid.setHorizontalSpacing(6)
        self._grid.setVerticalSpacing(0)
        grid_widget.setLayout(self._grid)

        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setFrameShape(QFrame.Shape.NoFrame)
        scroll_area.setWidget(grid_widget)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(scroll_area)

    def _rebuild_grid(self, schedules: list[Schedule]) -> None:
        self._clear_grid()
        self._add_headers()
        self._add_time_cells()

        for schedule in schedules:
            placement = self._schedule_placement(schedule)
            if placement is None:
                continue
            row, column, row_span = placement
            block = self._schedule_block(schedule)
            self._grid.addWidget(block, row, column, row_span, 1)

    def _add_headers(self) -> None:
        spacer = QLabel("")
        spacer.setFixedWidth(58)
        self._grid.addWidget(spacer, 0, 0)

        today = local_today(self._context.clock, self._settings.timezone)
        for offset in range(self._settings.calendar_days):
            current = self._week_start + timedelta(days=offset)
            header = QLabel(f"{WEEKDAYS_ZH[current.weekday()]}\n{current.month}月{current.day}日")
            header.setObjectName("dayHeader")
            header.setAlignment(Qt.AlignmentFlag.AlignCenter)
            header.setFont(TYPOGRAPHY.subheading.to_qfont())
            if current == today:
                header.setStyleSheet("background: #e07b3c;")
            self._grid.addWidget(header, 0, offset + 1)
            self._grid.setColumnStretch(offset + 1, 1)

    def _add_time_cells(self) -> None:
        slot_count = self._slot_count()
        for slot in range(slot_count):
            row = slot + 1
            minutes = self._settings.scheduler_start_hour * 60
            minutes += slot * self._settings.scheduler_slot_minutes

            if minutes % 60 == 0:
                label = QLabel(_format_minutes(minutes))
                label.setObjectName("timeLabel")
                label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignTop)
                label.setFont(TYPOGRAPHY.body_small.to_qfont())
                self._grid.addWidget(label, row, 0)

            for day_column in range(1, self._settings.calendar_days + 1):
                cell = QFrame()
                cell.setObjectName("timeCell")
                cell.setMinimumHeight(28)
                cell.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
                self._grid.addWidget(cell, row, day_column)

    def _schedule_block(self, schedule: Schedule) -> QPushButton:
        start = epoch_to_datetime(schedule.start_at, self._settings.timezone)
        end = epoch_to_datetime(schedule.end_at, self._settings.timezone)
        block = QPushButton(f"{start:%H:%M}-{end:%H:%M}\n{schedule.title}")
        block.setObjectName("scheduleBlock")
        block.setFont(TYPOGRAPHY.body_small.to_qfont())
        block.setCursor(Qt.CursorShape.PointingHandCursor)
        block.clicked.connect(lambda _checked=False, value=schedule: self._show_detail(value))
        return block

    def _schedule_placement(self, schedule: Schedule) -> tuple[int, int, int] | None:
        start = epoch_to_datetime(schedule.start_at, self._settings.timezone)
        end = epoch_to_datetime(schedule.end_at, self._settings.timezone)
        day_offset = (start.date() - self._week_start).days
        if not 0 <= day_offset < self._settings.calendar_days:
            return None

        day_start = _local_datetime(
            start.date(),
            self._settings.scheduler_start_hour,
            0,
            self._settings.timezone,
        )
        start_minutes = max(0, int((start - day_start).total_seconds() // 60))
        end_minutes = max(start_minutes + 1, int((end - day_start).total_seconds() // 60))

        visible_minutes = (
            self._settings.scheduler_end_hour - self._settings.scheduler_start_hour
        ) * 60
        if start_minutes >= visible_minutes or end_minutes <= 0:
            return None

        slot = self._settings.scheduler_slot_minutes
        start_slot = max(0, start_minutes // slot)
        end_slot = min(self._slot_count(), (end_minutes + slot - 1) // slot)
        row_span = max(1, end_slot - start_slot)
        return start_slot + 1, day_offset + 1, row_span

    def _show_detail(self, schedule: Schedule) -> None:
        start = epoch_to_datetime(schedule.start_at, self._settings.timezone)
        end = epoch_to_datetime(schedule.end_at, self._settings.timezone)
        lines = [
            schedule.title,
            f"{start:%Y年%m月%d日 %H:%M} - {end:%H:%M}",
        ]
        if schedule.location:
            lines.append(f"地点: {schedule.location}")
        if schedule.category:
            lines.append(f"分类: {schedule.category}")
        if schedule.description:
            lines.append("")
            lines.append(schedule.description)
        QMessageBox.information(self, "日程详情", "\n".join(lines))

    def _clear_grid(self) -> None:
        while self._grid.count():
            item = self._grid.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()

    def _slot_count(self) -> int:
        minutes = (self._settings.scheduler_end_hour - self._settings.scheduler_start_hour) * 60
        return minutes // self._settings.scheduler_slot_minutes

    def _week_start_for(self, value: date) -> date:
        delta = (value.weekday() - self._settings.week_start) % 7
        return value - timedelta(days=delta)

    def _show_error(self, exc: AMToDoError) -> None:
        QMessageBox.warning(self, "AMToDo", str(exc))


def _format_minutes(minutes: int) -> str:
    return f"{minutes // 60:02d}:00"


def _local_datetime(value: date, hour: int, minute: int, timezone: str) -> datetime:
    return datetime.combine(value, time(hour=hour, minute=minute), tzinfo=ZoneInfo(timezone))
