"""Optional Presidio-backed PII NER integration."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from infrastructure.config import settings

logger = logging.getLogger("babylexit.security.pii_ner")

_PERSON_RE = re.compile(
    r"\b[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}){1,2}\b",
    re.UNICODE,
)
_PERSON_LEGAL_EXCLUDE = re.compile(
    r"\b(?:Mahkemesi|Kanunu|Kanun|Yargitay|Danistay|Bakanligi|Mudurlugu|Genelge|Teblig)\b",
    re.IGNORECASE,
)
_ROLE_NAME_RE = re.compile(
    r"(?i:\b(?:muvekkil|davaci|davali|sanik|sikayetci|tanik)\b)\s+"
    r"([A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}){1,2})\b",
    re.UNICODE,
)
_ROLE_TOKENS = {"muvekkil", "davaci", "davali", "sanik", "sikayetci", "tanik"}


@dataclass(frozen=True)
class PiiEntity:
    entity_type: str
    text: str
    score: float


class PiiNerEngine:
    """Lazy Presidio wrapper with graceful fallback."""

    def __init__(self) -> None:
        self._analyzer = None
        self._init_attempted = False
        self._gliner_model = None
        self._gliner_init_attempted = False

    def detect(self, text: str, *, entities: list[str], score_threshold: float) -> list[PiiEntity]:
        body = (text or "").strip()
        if not body:
            return []
        analyzer = self._load_analyzer()
        out: list[PiiEntity] = []
        if analyzer is not None:
            try:
                findings = analyzer.analyze(
                    text=body,
                    language="tr",
                    entities=entities or None,
                    score_threshold=max(0.0, float(score_threshold)),
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("PII_NER_ANALYZE_FAILED | reason=%s", exc)
                if bool(getattr(settings, "kvkk_fail_closed_on_ner_error", True)):
                    raise RuntimeError("PII_NER_ANALYZE_FAILED") from exc
                findings = []

            for item in findings:
                start = int(getattr(item, "start", -1))
                end = int(getattr(item, "end", -1))
                if start < 0 or end <= start or end > len(body):
                    continue
                span = body[start:end].strip()
                if not span:
                    continue
                out.append(
                    PiiEntity(
                        entity_type=str(getattr(item, "entity_type", "PII") or "PII"),
                        text=span,
                        score=float(getattr(item, "score", 0.0) or 0.0),
                    )
                )

        if bool(getattr(settings, "kvkk_gliner_enabled", False)):
            try:
                out.extend(
                    self._detect_with_gliner(
                        text=body,
                        entities=entities,
                        score_threshold=max(0.0, float(score_threshold)),
                    )
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("PII_NER_GLINER_FAILED | reason=%s", exc)
                if bool(getattr(settings, "kvkk_gliner_fail_closed", False)):
                    raise RuntimeError("PII_NER_GLINER_FAILED") from exc

        if bool(getattr(settings, "kvkk_model_ner_fallback_enabled", True)):
            out.extend(
                self._detect_contextual_entities(
                    text=body,
                    entities=entities,
                    score_threshold=max(0.0, float(score_threshold)),
                )
            )

        dedup: dict[tuple[str, str], PiiEntity] = {}
        for entity in out:
            key = (entity.entity_type, entity.text)
            prev = dedup.get(key)
            if prev is None or entity.score > prev.score:
                dedup[key] = entity
        return list(dedup.values())

    def _load_analyzer(self):
        if self._init_attempted:
            return self._analyzer
        self._init_attempted = True
        try:
            from presidio_analyzer import AnalyzerEngine  # type: ignore[import-untyped]
        except Exception as exc:
            if bool(getattr(settings, "kvkk_presidio_enabled", False)) and bool(
                getattr(settings, "kvkk_fail_closed_on_ner_error", True)
            ):
                raise RuntimeError("PII_NER_PRESIDIO_UNAVAILABLE") from exc
            logger.info("PII_NER_DISABLED | presidio_analyzer_unavailable")
            self._analyzer = None
            return None
        try:
            self._analyzer = AnalyzerEngine()
            return self._analyzer
        except Exception as exc:  # noqa: BLE001
            logger.warning("PII_NER_INIT_FAILED | reason=%s", exc)
            if bool(getattr(settings, "kvkk_fail_closed_on_ner_error", True)):
                raise RuntimeError("PII_NER_INIT_FAILED") from exc
            self._analyzer = None
            return None

    def _load_gliner(self):
        if self._gliner_init_attempted:
            return self._gliner_model
        self._gliner_init_attempted = True
        try:
            from gliner import GLiNER  # type: ignore[import-untyped]
        except Exception:
            logger.info("PII_NER_GLINER_UNAVAILABLE")
            self._gliner_model = None
            return None
        model_id = str(
            getattr(settings, "kvkk_gliner_model", "urchade/gliner_multi-v2.1")
            or "urchade/gliner_multi-v2.1"
        )
        try:
            self._gliner_model = GLiNER.from_pretrained(model_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("PII_NER_GLINER_INIT_FAILED | model=%s | reason=%s", model_id, exc)
            self._gliner_model = None
            return None
        return self._gliner_model

    def _detect_with_gliner(
        self,
        *,
        text: str,
        entities: list[str],
        score_threshold: float,
    ) -> list[PiiEntity]:
        model = self._load_gliner()
        if model is None:
            return []
        configured_labels = [
            item.strip()
            for item in str(getattr(settings, "kvkk_gliner_labels", "") or "").split(",")
            if item.strip()
        ]
        labels = configured_labels or [
            "person",
            "location",
            "organization",
            "address",
            "email",
            "phone",
            "iban",
            "tckn",
            "vkn",
        ]
        try:
            findings = model.predict_entities(text, labels, threshold=max(0.0, float(score_threshold)))
        except TypeError:
            findings = model.predict_entities(text, labels)
        out: list[PiiEntity] = []
        allowed = {str(item or "").strip().upper() for item in (entities or [])}
        for item in findings or []:
            if not isinstance(item, dict):
                continue
            span = str(item.get("text") or "").strip()
            if not span:
                continue
            label = str(item.get("label") or item.get("entity_type") or "PII").strip()
            entity_type = _map_gliner_label(label)
            if allowed and entity_type not in allowed:
                continue
            try:
                score = float(item.get("score", 0.0) or 0.0)
            except Exception:
                score = 0.0
            if score < max(0.0, float(score_threshold)):
                continue
            out.append(PiiEntity(entity_type=entity_type, text=span, score=score))
        return out

    def _detect_contextual_entities(
        self,
        *,
        text: str,
        entities: list[str],
        score_threshold: float,
    ) -> list[PiiEntity]:
        entity_set = {str(item or "").strip().upper() for item in (entities or [])}
        out: list[PiiEntity] = []
        threshold = max(0.0, float(score_threshold))

        if (not entity_set) or ("PERSON" in entity_set):
            for match in _PERSON_RE.finditer(text):
                span = _clean_person_span(match.group(0))
                if not span:
                    continue
                if _PERSON_LEGAL_EXCLUDE.search(span):
                    continue
                score = 0.62
                if score >= threshold:
                    out.append(PiiEntity(entity_type="PERSON", text=span, score=score))
            for match in _ROLE_NAME_RE.finditer(text):
                span = _clean_person_span(match.group(1))
                if not span:
                    continue
                if _PERSON_LEGAL_EXCLUDE.search(span):
                    continue
                score = 0.68
                if score >= threshold:
                    out.append(PiiEntity(entity_type="PERSON", text=span, score=score))

        return out


def _clean_person_span(span: str) -> str:
    tokens = [part for part in str(span or "").split() if part]
    while tokens and tokens[0].lower() in _ROLE_TOKENS:
        tokens = tokens[1:]
    if len(tokens) < 2:
        return ""
    cleaned = " ".join(tokens[:3]).strip()
    if not cleaned:
        return ""
    # Guard against accidental lower-case tail captures from noisy spans.
    parts = cleaned.split()
    if any(not part[0].isupper() for part in parts):
        return ""
    return cleaned


def _map_gliner_label(label: str) -> str:
    token = str(label or "").strip().lower()
    mapping = {
        "person": "PERSON",
        "name": "PERSON",
        "human": "PERSON",
        "location": "LOCATION",
        "address": "LOCATION",
        "org": "ORGANIZATION",
        "organization": "ORGANIZATION",
        "email": "EMAIL_ADDRESS",
        "e-mail": "EMAIL_ADDRESS",
        "phone": "PHONE_NUMBER",
        "telephone": "PHONE_NUMBER",
        "iban": "IBAN_CODE",
        "tckn": "TR_ID",
        "tc_kimlik": "TR_ID",
        "vkn": "TR_TAX_ID",
    }
    return mapping.get(token, str(label or "PII").upper())


pii_ner_engine = PiiNerEngine()
