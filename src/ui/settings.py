"""Hardcoded UI settings and typography tokens."""

from __future__ import annotations

from dataclasses import dataclass

from PySide6.QtGui import QFont


@dataclass(frozen=True, slots=True)
class FontSpec:
    """A single font specification.  Size is in points (pt)."""

    family: str
    size_pt: int
    weight: QFont.Weight = QFont.Weight.Normal

    def to_qfont(self) -> QFont:
        font = QFont(self.family, self.size_pt)
        font.setWeight(self.weight)
        return font


@dataclass(frozen=True, slots=True)
class TypographyTokens:
    """Semantic font tokens organised by hierarchy tier.

    Hierarchy (分层):
      display     - month/year header in the calendar strip
      heading     - date numbers in calendar day cells
      subheading  - weekday labels in calendar day cells
      body        - todo item titles
      body_small  - empty-state placeholder, secondary labels
      button      - actionable buttons
    """

    display: FontSpec
    heading: FontSpec
    subheading: FontSpec
    body: FontSpec
    body_small: FontSpec
    button: FontSpec


# -- hardcoded defaults -------------------------------------------------------

DEFAULT_FAMILY = "Microsoft YaHei UI"

TYPOGRAPHY = TypographyTokens(
    display=FontSpec(DEFAULT_FAMILY, 28, QFont.Weight.Bold),
    heading=FontSpec(DEFAULT_FAMILY, 24, QFont.Weight.DemiBold),
    subheading=FontSpec(DEFAULT_FAMILY, 13, QFont.Weight.DemiBold),
    body=FontSpec(DEFAULT_FAMILY, 14, QFont.Weight.Normal),
    body_small=FontSpec(DEFAULT_FAMILY, 13, QFont.Weight.Normal),
    button=FontSpec(DEFAULT_FAMILY, 14, QFont.Weight.DemiBold),
)


@dataclass(frozen=True, slots=True)
class UISettings:
    """Desktop UI preferences."""

    language: str = "zh_CN"
    timezone: str = "Asia/Shanghai"
    font_family: str = DEFAULT_FAMILY
    font_size: int = 28
    calendar_days: int = 7
    week_start: int = 0
    scheduler_start_hour: int = 6
    scheduler_end_hour: int = 24
    scheduler_slot_minutes: int = 30


DEFAULT_UI_SETTINGS = UISettings()
