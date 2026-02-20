"""
infrastructure/privacy
======================
Two-layer PII protection for KVKK (Law No. 6698) compliance.

Layer 1 — Reversible masking (request/response pipeline)
    Class : PrivacyMiddleware   (Starlette BaseHTTPMiddleware)
    Module: api.middleware.privacy_gateway
    Purpose: Intercepts HTTP requests, masks PII with placeholder tokens
             before the payload reaches any LLM or external service,
             then unmasks the response before returning it to the user.
    Pattern: mask → process → unmask  (lossless, reversible)

Layer 2 — Irreversible redaction (prompts + logs + audit trail)
    Class : KVKKRedactor
    Module: infrastructure.security.kvkk_redactor
    Purpose: Permanently replaces PII with typed tokens ([TC_KIMLIK],
             [TELEFON], [EPOSTA], [IBAN], [ADRES]) in LLM prompts,
             log lines, and audit records.  There is NO reverse operation.
    Pattern: detect → replace → record (destructive, auditable)

PII types detected (Turkish-specific):
    TC_KIMLIK   — T.C. Kimlik No (11-digit national ID)
    TELEFON     — Turkish mobile/landline (+90 5xx xxx xx xx)
    EPOSTA      — E-mail addresses
    IBAN        — Turkish IBAN (TR + 24 digits)
    ADRES       — Street addresses (Sokak / Cadde / Bulvar / Cad. / Sok.)

Usage:
    # Irreversible redaction before LLM call or log write:
    from infrastructure.privacy import kvkk_redactor, KVKKRedactor
    clean, records = kvkk_redactor.redact(user_input)
    safe_log = kvkk_redactor.redact_for_log(some_string)

    # Reversible middleware is registered in api/main.py:
    #   app.add_middleware(PrivacyMiddleware)
    # Import it from its home module:
    from api.middleware.privacy_gateway import PrivacyMiddleware
"""

from infrastructure.security.kvkk_redactor import (
    KVKKRedactor,
    RedactionRecord,
    kvkk_redactor,
)

__all__ = [
    "KVKKRedactor",
    "RedactionRecord",
    "kvkk_redactor",
]
