"""PII/NER redaction regression gates for privacy middleware."""

from __future__ import annotations

from fastapi import FastAPI
import pytest

from api.middleware.privacy_gateway import PrivacyMiddleware
from infrastructure.config import settings
from infrastructure.security.pii_ner import PiiEntity, pii_ner_engine


@pytest.fixture(autouse=True)
def _privacy_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "enable_privacy_middleware", True)
    monkeypatch.setattr(settings, "kvkk_model_ner_enabled", True)
    monkeypatch.setattr(settings, "kvkk_presidio_enabled", False)
    monkeypatch.setattr(settings, "kvkk_model_ner_score_threshold", 0.55)


def test_privacy_middleware_masks_contextual_person_from_ner(monkeypatch: pytest.MonkeyPatch) -> None:
    middleware = PrivacyMiddleware(FastAPI())
    monkeypatch.setattr(
        pii_ner_engine,
        "detect",
        lambda **_: [PiiEntity(entity_type="PERSON", text="Ahmet Yılmaz", score=0.83)],
    )

    masked, counts = middleware._mask_pii("Müvekkil Ahmet Yılmaz bugün ofise geldi.", "mask-1")

    assert "Ahmet Yılmaz" not in masked
    assert "[MASKED_PERSON_" in masked
    assert counts.get("person", 0) >= 1


def test_privacy_middleware_does_not_over_redact_legal_terms(monkeypatch: pytest.MonkeyPatch) -> None:
    middleware = PrivacyMiddleware(FastAPI())
    monkeypatch.setattr(
        pii_ner_engine,
        "detect",
        lambda **_: [PiiEntity(entity_type="PERSON", text="Ağır Ceza Mahkemesi", score=0.91)],
    )

    text = "Ağır Ceza Mahkemesi görevli mahkemedir."
    masked, counts = middleware._mask_pii(text, "mask-2")

    assert masked == text
    assert counts.get("person", 0) == 0


def test_privacy_middleware_fail_closed_when_ner_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    middleware = PrivacyMiddleware(FastAPI())
    monkeypatch.setattr(settings, "kvkk_fail_closed_on_ner_error", True)

    def _raise(**_: object) -> list[PiiEntity]:
        raise RuntimeError("ner_unavailable")

    monkeypatch.setattr(pii_ner_engine, "detect", _raise)

    with pytest.raises(RuntimeError, match="ner_unavailable"):
        middleware._mask_pii("Müvekkil Ahmet Yılmaz", "mask-3")


def test_privacy_middleware_irreversible_mode_does_not_store_map(monkeypatch: pytest.MonkeyPatch) -> None:
    middleware = PrivacyMiddleware(FastAPI())
    monkeypatch.setattr(settings, "kvkk_redaction_mode", "irreversible")
    monkeypatch.setattr(
        pii_ner_engine,
        "detect",
        lambda **_: [PiiEntity(entity_type="PERSON", text="Ahmet Yılmaz", score=0.90)],
    )

    masked, _ = middleware._mask_pii("Müvekkil Ahmet Yılmaz bugün geldi.", "mask-4")
    assert "[REDACTED_PERSON]" in masked
    assert "mask-4" not in middleware.mask_store
