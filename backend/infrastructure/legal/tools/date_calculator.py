"""
Date Calculator — Step 14: Agentic Tool Calling (Matematik/Süre Hesabı)
========================================================================
Deterministic, pure-Python date arithmetic for Turkish legal deadline calculations.

Design principles:
    - PURE functions (no side effects, no I/O, no randomness).
    - Turkish calendar rules: Saturdays and Sundays are non-business days.
      Official Turkish public holidays are NOT encoded here — they change
      annually.  The deadline_engine layer adds holiday-awareness when needed.
    - All functions accept and return ``datetime.date`` objects.
    - On invalid input, raises ``ValueError`` with a descriptive message.

Legal Basis:
    HMK md. 92-94  — Civil procedure deadline calculation rules
    İYUK md. 8     — Administrative procedure deadline calculation rules
    HUMK md. 162   — Legacy code (superseded by HMK for reference)
    TCK md. 66-68  — Prescription period rules (criminal law)
"""

from __future__ import annotations

import calendar
import logging
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

logger = logging.getLogger("babylexit.legal.tools.date_calculator")


# ============================================================================
# Result type
# ============================================================================


@dataclass(frozen=True)
class DateCalculatorResult:
    """Return value from date arithmetic operations."""

    result_date: date
    """The computed deadline / end date."""

    days_from_start: int
    """Calendar days between start_date and result_date (inclusive of end)."""

    business_days_from_start: int
    """Working days (Mon-Fri) between start_date and result_date."""

    input_date: date
    """The start/input date used for the calculation."""

    description: str = ""
    """Human-readable explanation of what was calculated."""


# ============================================================================
# Business-day helpers
# ============================================================================


def is_business_day(d: date) -> bool:
    """
    Returns True if ``d`` is a Monday–Friday (not Saturday or Sunday).

    Note: Turkish public holidays are not encoded here.  Use the
    ``legal_deadline_engine`` for holiday-aware calculations.

    Args:
        d: A ``datetime.date`` object.

    Returns:
        bool — True if it is a working day.
    """
    return d.weekday() < 5  # 0=Mon … 4=Fri, 5=Sat, 6=Sun


def business_days_between(start: date, end: date) -> int:
    """
    Counts the number of business days (Mon-Fri) between two dates.

    The range is INCLUSIVE of both ``start`` and ``end``.
    If ``end < start``, returns a negative value.

    Args:
        start: Start date.
        end:   End date.

    Returns:
        Integer count of business days.  Negative if end < start.
    """
    if end == start:
        return 1 if is_business_day(start) else 0

    sign = 1 if end >= start else -1
    lo, hi = (start, end) if sign == 1 else (end, start)

    count = 0
    current = lo
    while current <= hi:
        if is_business_day(current):
            count += 1
        current += timedelta(days=1)

    return sign * count


# ============================================================================
# Calendar arithmetic
# ============================================================================


def add_calendar_days(start: date, days: int) -> DateCalculatorResult:
    """
    Adds ``days`` calendar days to ``start``.

    Args:
        start: Base date.
        days:  Number of days to add (can be negative for subtraction).

    Returns:
        DateCalculatorResult with result_date = start + days.
    """
    result = start + timedelta(days=days)
    bdays = business_days_between(start, result) if days >= 0 else -business_days_between(result, start)
    return DateCalculatorResult(
        result_date=result,
        days_from_start=days,
        business_days_from_start=bdays,
        input_date=start,
        description=f"{start.isoformat()} + {days} takvim günü = {result.isoformat()}",
    )


def add_months(start: date, months: int) -> DateCalculatorResult:
    """
    Adds ``months`` calendar months to ``start``.

    Handles month-end edge cases (e.g. Jan 31 + 1 month = Feb 28/29).

    Args:
        start:  Base date.
        months: Number of months to add (can be negative).

    Returns:
        DateCalculatorResult with result_date.

    Raises:
        ValueError: If ``months`` would produce an invalid year.
    """
    year = start.year + (start.month - 1 + months) // 12
    month = (start.month - 1 + months) % 12 + 1
    # Clamp day to valid range for the target month (handles Jan 31 → Feb 28)
    max_day = calendar.monthrange(year, month)[1]
    day = min(start.day, max_day)
    result = date(year, month, day)

    days_diff = (result - start).days
    bdays = business_days_between(start, result) if days_diff >= 0 else -business_days_between(result, start)
    return DateCalculatorResult(
        result_date=result,
        days_from_start=days_diff,
        business_days_from_start=bdays,
        input_date=start,
        description=f"{start.isoformat()} + {months} ay = {result.isoformat()}",
    )


def add_years(start: date, years: int) -> DateCalculatorResult:
    """
    Adds ``years`` to ``start``.

    Handles Feb 29 leap-year edge case (Feb 29 + 1 year = Feb 28).

    Args:
        start: Base date.
        years: Number of years to add.

    Returns:
        DateCalculatorResult with result_date.
    """
    try:
        result = date(start.year + years, start.month, start.day)
    except ValueError:
        # Feb 29 in a non-leap target year → Feb 28
        result = date(start.year + years, start.month, 28)

    days_diff = (result - start).days
    bdays = business_days_between(start, result) if days_diff >= 0 else -business_days_between(result, start)
    return DateCalculatorResult(
        result_date=result,
        days_from_start=days_diff,
        business_days_from_start=bdays,
        input_date=start,
        description=f"{start.isoformat()} + {years} yıl = {result.isoformat()}",
    )


def next_business_day(d: date) -> date:
    """
    Returns ``d`` itself if it is a business day, otherwise returns
    the next Monday.

    Useful for adjusting deadlines that fall on weekends.

    Args:
        d: Target date.

    Returns:
        ``d`` or the next working day.
    """
    while not is_business_day(d):
        d += timedelta(days=1)
    return d
