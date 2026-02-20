"""
Date Calculator — Step 14: Agentic Tool Calling (Matematik/Süre Hesabı)
========================================================================
Deterministic, pure-Python date arithmetic for Turkish legal deadline calculations.

Design principles:
    - PURE functions (no side effects, no I/O, no randomness).
    - Turkish calendar rules: Saturdays and Sundays are non-business days.
      Official Turkish public holidays are encoded in ``_RELIGIOUS_HOLIDAYS``
      for 2024-2030 and static fixed holidays for any year.
      ``add_business_days()`` and ``next_business_day()`` are holiday-aware.
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
# Turkish Public Holiday Calendar
# ============================================================================

# Sabit resmî tatiller (ay, gün) — her yıl aynı
_FIXED_HOLIDAY_MMDD: frozenset[tuple[int, int]] = frozenset({
    (1, 1),    # Yılbaşı
    (4, 23),   # Ulusal Egemenlik ve Çocuk Bayramı
    (5, 1),    # İşçi ve Emekçi Bayramı
    (5, 19),   # Atatürk'ü Anma, Gençlik ve Spor Bayramı
    (7, 15),   # Demokrasi ve Millî Birlik Günü (2017 itibarıyla)
    (8, 30),   # Zafer Bayramı
    (10, 29),  # Cumhuriyet Bayramı
})

# Dini bayramlar — Hicrî takvime göre yıla özgü (arife dahil)
# Kaynak: Diyanet İşleri Başkanlığı takvimi + Cumhurbaşkanlığı Genelgeleri
_RELIGIOUS_HOLIDAYS: dict[int, frozenset[date]] = {
    2024: frozenset({
        # Ramazan Bayramı: arife + 3 gün
        date(2024, 4, 9),  date(2024, 4, 10), date(2024, 4, 11), date(2024, 4, 12),
        # Kurban Bayramı: arife + 4 gün
        date(2024, 6, 15), date(2024, 6, 16), date(2024, 6, 17),
        date(2024, 6, 18), date(2024, 6, 19),
    }),
    2025: frozenset({
        # Ramazan Bayramı
        date(2025, 3, 29), date(2025, 3, 30), date(2025, 3, 31), date(2025, 4, 1),
        # Kurban Bayramı
        date(2025, 6, 5),  date(2025, 6, 6),  date(2025, 6, 7),
        date(2025, 6, 8),  date(2025, 6, 9),
    }),
    2026: frozenset({
        # Ramazan Bayramı
        date(2026, 3, 19), date(2026, 3, 20), date(2026, 3, 21), date(2026, 3, 22),
        # Kurban Bayramı
        date(2026, 5, 26), date(2026, 5, 27), date(2026, 5, 28),
        date(2026, 5, 29), date(2026, 5, 30),
    }),
    2027: frozenset({
        # Ramazan Bayramı
        date(2027, 3, 8),  date(2027, 3, 9),  date(2027, 3, 10), date(2027, 3, 11),
        # Kurban Bayramı
        date(2027, 5, 15), date(2027, 5, 16), date(2027, 5, 17),
        date(2027, 5, 18), date(2027, 5, 19),
    }),
    2028: frozenset({
        # Ramazan Bayramı
        date(2028, 2, 25), date(2028, 2, 26), date(2028, 2, 27), date(2028, 2, 28),
        # Kurban Bayramı
        date(2028, 5, 4),  date(2028, 5, 5),  date(2028, 5, 6),
        date(2028, 5, 7),  date(2028, 5, 8),
    }),
    2029: frozenset({
        # Ramazan Bayramı
        date(2029, 2, 13), date(2029, 2, 14), date(2029, 2, 15), date(2029, 2, 16),
        # Kurban Bayramı
        date(2029, 4, 24), date(2029, 4, 25), date(2029, 4, 26),
        date(2029, 4, 27), date(2029, 4, 28),
    }),
    2030: frozenset({
        # Ramazan Bayramı
        date(2030, 2, 2),  date(2030, 2, 3),  date(2030, 2, 4),  date(2030, 2, 5),
        # Kurban Bayramı
        date(2030, 4, 13), date(2030, 4, 14), date(2030, 4, 15),
        date(2030, 4, 16), date(2030, 4, 17),
    }),
}


def get_turkish_holidays(year: int) -> frozenset[date]:
    """
    Verilen yıl için Türk resmî tatillerini döndürür.

    Sabit tatiller her yıl hesaplanır; dini bayramlar (Ramazan + Kurban
    arifeleri dahil) 2024-2030 yılları için kodlanmıştır.  Kapsam dışı
    yıllarda sadece sabit tatiller döndürülür ve bir uyarı logu yazılır.

    Args:
        year: Takvim yılı (ör. 2026).

    Returns:
        O yıla ait tatil tarihlerinden oluşan frozenset[date].
    """
    fixed = frozenset(
        date(year, m, d)
        for m, d in _FIXED_HOLIDAY_MMDD
    )
    religious = _RELIGIOUS_HOLIDAYS.get(year, frozenset())
    if year not in _RELIGIOUS_HOLIDAYS:
        logger.warning(
            "Turkish religious holidays not available for year %d; "
            "only fixed holidays will be observed. "
            "Add entries to _RELIGIOUS_HOLIDAYS in date_calculator.py.",
            year,
        )
    return fixed | religious


def is_turkish_holiday(d: date) -> bool:
    """
    Verilen tarihin Türk resmî tatili olup olmadığını kontrol eder.

    Sabit tatiller O(1), dini bayramlar set-lookup ile kontrol edilir.

    Args:
        d: Kontrol edilecek tarih.

    Returns:
        True ise resmî tatil, False ise normal gün.
    """
    if (d.month, d.day) in _FIXED_HOLIDAY_MMDD:
        return True
    return d in _RELIGIOUS_HOLIDAYS.get(d.year, frozenset())


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
    Verilen tarih iş günüyse aynen döndürür; hafta sonu veya resmî
    tatilse bir sonraki iş gününe ilerler.

    Hukuki süre hesabında sürenin son günü tatile denk gelirse süre
    ilk iş günü uzar (HMK md. 92/3).

    Args:
        d: Hedef tarih.

    Returns:
        ``d`` veya sonraki çalışma günü.
    """
    while not is_business_day(d) or is_turkish_holiday(d):
        d += timedelta(days=1)
    return d


def add_business_days(start: date, days: int) -> DateCalculatorResult:
    """
    Başlangıç tarihine ``days`` iş günü ekler.

    Hafta sonları (Cumartesi-Pazar) ve Türkiye resmî tatillerini (sabit
    + dini bayramlar, arife dahil) atlar.  Negatif değer geçmişe gider.

    Hukuki dayanak:
        HMK md. 92-94 — Medeni yargılama sürelerinin hesabı
        İYUK md. 8    — İdari yargılama sürelerinin hesabı

    Args:
        start: Başlangıç tarihi.
        days:  Eklenecek iş günü sayısı (negatif olabilir).

    Returns:
        DateCalculatorResult — result_date, days_from_start, vb.
    """
    if days == 0:
        return DateCalculatorResult(
            result_date=start,
            days_from_start=0,
            business_days_from_start=0,
            input_date=start,
            description=f"{start.isoformat()} + 0 iş günü = {start.isoformat()}",
        )

    step = timedelta(days=1 if days > 0 else -1)
    remaining = abs(days)
    current = start
    while remaining > 0:
        current += step
        if is_business_day(current) and not is_turkish_holiday(current):
            remaining -= 1

    cal_days = (current - start).days
    bdays = (
        business_days_between(start, current)
        if cal_days >= 0
        else -business_days_between(current, start)
    )
    return DateCalculatorResult(
        result_date=current,
        days_from_start=cal_days,
        business_days_from_start=bdays,
        input_date=start,
        description=f"{start.isoformat()} + {days} iş günü = {current.isoformat()}",
    )
