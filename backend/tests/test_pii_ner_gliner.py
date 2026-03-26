"""GLiNER integration tests for PII NER engine."""

from __future__ import annotations

import pytest

from infrastructure.config import settings
from infrastructure.security.pii_ner import PiiEntity, PiiNerEngine, _map_gliner_label


def test_map_gliner_label_normalizes_common_entities() -> None:
    assert _map_gliner_label("person") == "PERSON"
    assert _map_gliner_label("email") == "EMAIL_ADDRESS"
    assert _map_gliner_label("phone") == "PHONE_NUMBER"
    assert _map_gliner_label("iban") == "IBAN_CODE"


def test_detect_includes_gliner_entities_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "kvkk_gliner_enabled", True)
    monkeypatch.setattr(settings, "kvkk_gliner_fail_closed", False)
    monkeypatch.setattr(settings, "kvkk_model_ner_fallback_enabled", False)

    engine = PiiNerEngine()
    monkeypatch.setattr(engine, "_load_analyzer", lambda: None)
    monkeypatch.setattr(
        engine,
        "_detect_with_gliner",
        lambda **_: [PiiEntity(entity_type="PERSON", text="Ahmet Yılmaz", score=0.9)],
    )

    out = engine.detect(
        "Müvekkil Ahmet Yılmaz ofise geldi.",
        entities=["PERSON"],
        score_threshold=0.5,
    )
    assert any(item.entity_type == "PERSON" and item.text == "Ahmet Yılmaz" for item in out)


def test_detect_raises_when_gliner_fail_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "kvkk_gliner_enabled", True)
    monkeypatch.setattr(settings, "kvkk_gliner_fail_closed", True)
    monkeypatch.setattr(settings, "kvkk_model_ner_fallback_enabled", False)

    engine = PiiNerEngine()
    monkeypatch.setattr(engine, "_load_analyzer", lambda: None)

    def _raise(**_: object):
        raise RuntimeError("gliner_down")

    monkeypatch.setattr(engine, "_detect_with_gliner", _raise)

    with pytest.raises(RuntimeError, match="PII_NER_GLINER_FAILED"):
        engine.detect(
            "Ahmet Yılmaz",
            entities=["PERSON"],
            score_threshold=0.5,
        )
