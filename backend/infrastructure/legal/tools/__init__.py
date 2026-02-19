"""
Step 14 — Agentic Tool Calling: Matematik/Süre Hesabı
======================================================
Deterministic Python tools for Turkish legal date and deadline calculations.

Modules:
    date_calculator   — Low-level date arithmetic (business days, month-end rules)
    deadline_engine   — High-level Turkish legal deadline catalogue
    tool_dispatcher   — Intent detection + tool execution + context injection
"""

from infrastructure.legal.tools.date_calculator import (
    DateCalculatorResult,
    add_calendar_days,
    add_months,
    add_years,
    business_days_between,
    is_business_day,
)
from infrastructure.legal.tools.deadline_engine import (
    DeadlineResult,
    DeadlineTool,
    LegalDeadlineEngine,
    legal_deadline_engine,
)

__all__ = [
    # date_calculator
    "DateCalculatorResult",
    "add_calendar_days",
    "add_months",
    "add_years",
    "business_days_between",
    "is_business_day",
    # deadline_engine
    "DeadlineResult",
    "DeadlineTool",
    "LegalDeadlineEngine",
    "legal_deadline_engine",
]
