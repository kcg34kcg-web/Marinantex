"""
API Schemas  —  Pydantic v2
Request / Response contracts for the V2.1 RAG pipeline.

CRITICAL RULE (Step 1 — Hard-Fail):
    RAGResponse enforces a non-empty `sources` list via @model_validator.
    Any attempt to construct a RAGResponse without sources raises ValueError
    at schema-validation time.  This is the SECOND line of defence;
    the primary Hard-Fail gate lives in RAGService (raises HTTP 422 before
    the LLM is ever called).

STEP 2 (Kaynak Envanteri):
    SourceDocumentSchema surfaces source_url, version, and collected_at so
    the client can audit provenance for every cited document.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, computed_field, model_validator

logger = logging.getLogger("babylexit.schemas")


# ============================================================================
# Step 16: Zero-Trust Generation — Answer Sentence + Inline Citation schemas
# ============================================================================

class AnswerSentence(BaseModel):
    """
    A single sentence from the LLM-generated answer, with inline citation refs.

    Enables "single-click verification": the UI can use source_refs to
    jump directly to the cited source document when the user taps a sentence.

    Step 16: Produced by ZeroTrustPromptBuilder.parse_answer_sentences().
    """

    sentence_id: int = Field(
        ..., ge=0, description="0-based ordinal of this sentence in the full answer"
    )
    text: str = Field(
        ..., description="Raw sentence text, including [K:N] citation markers"
    )
    source_refs: List[int] = Field(
        default_factory=list,
        description="1-based source indices ([K:1] → 1) referenced by this sentence",
    )

    @computed_field
    @property
    def is_grounded(self) -> bool:
        """True when at least one source citation is attached to this sentence."""
        return len(self.source_refs) > 0


class InlineCitation(BaseModel):
    """
    Maps a sentence to the specific source documents it cites.

    Enables the UI to draw a direct line from each cited claim to the
    source document chunk that supports it — "every sentence verifiable
    with one click."

    Step 16: Built in RAGService after ZeroTrustPromptBuilder.parse().
    """

    sentence_id: int = Field(..., ge=0, description="Maps to AnswerSentence.sentence_id")
    source_indices: List[int] = Field(
        ..., description="1-based indices of cited sources (matches [K:N] markers)"
    )
    source_ids: List[str] = Field(
        ..., description="UUID of each cited SourceDocumentSchema (for deep-linking)"
    )


# ============================================================================
# Step 16: Mandatory Legal Disclaimer Schema
# ============================================================================

class LegalDisclaimerSchema(BaseModel):
    """
    Mandatory legal disclaimer attached to every RAGResponse.

    The model_validator in RAGResponse auto-generates this field if it is
    absent, ensuring the disclaimer cannot be omitted — even in tests.

    Severity levels:
        INFO     — Base GENEL_HUKUKI only (routine factual query).
        WARNING  — Lehe kanun activated (TCK md. 7/2 comparison required).
        CRITICAL — AYM-cancelled sources or Tier 3/4 complex analysis.

    Step 16 acceptance criterion:
        Every RAGResponse MUST carry a non-null legal_disclaimer.
    """

    disclaimer_text: str = Field(
        ...,
        description=(
            "Combined Turkish-language mandatory disclaimer text. "
            "UI MUST display this text prominently before the answer."
        ),
    )
    disclaimer_types: List[str] = Field(
        ...,
        description=(
            "Active disclaimer type identifiers: "
            "GENEL_HUKUKI | AYM_IPTAL_UYARISI | LEHE_KANUN | UZMAN_ZORUNLU | DUSUK_GROUNDING"
        ),
    )
    severity: str = Field(
        ...,
        description="Overall severity level: INFO | WARNING | CRITICAL",
    )
    requires_expert_review: bool = Field(
        ...,
        description=(
            "True when UZMAN_ZORUNLU is active — UI must show a prominent "
            "'consult a lawyer' call-to-action."
        ),
    )
    generated_at: datetime = Field(
        ..., description="UTC timestamp when this disclaimer was generated"
    )
    legal_basis: Optional[str] = Field(
        None,
        description=(
            "Statutory basis for the disclaimer requirements, e.g. "
            "'Avukatlık Kanunu md. 35 | TBB Meslek Kuralları md. 3'"
        ),
    )


# ============================================================================
# Step 17: Cost Estimate Schema
# ============================================================================

class CostEstimateSchema(BaseModel):
    """
    Estimated cost for a single RAG request.

    Computed by CostTracker.estimate() from token counts and model-specific
    pricing tables.  Enables per-request cost attribution and dashboard reporting.

    Step 17 acceptance criterion:
        Every non-cached RAGResponse carries a non-null cost_estimate in its
        audit_trail, allowing compliance teams to audit spend per query.
    """

    input_tokens: int = Field(
        ..., ge=0, description="Estimated tokens sent to the LLM (query + context)"
    )
    output_tokens: int = Field(
        ..., ge=0, description="Estimated tokens received from the LLM (answer)"
    )
    total_cost_usd: float = Field(
        ..., ge=0.0, description="Estimated total cost in USD"
    )
    model_id: str = Field(
        ..., description="Full model label used for cost attribution"
    )
    tier: int = Field(
        ..., ge=1, le=4, description="LLM query tier (1–4)"
    )
    cached: bool = Field(
        default=False,
        description="True when served from semantic cache — cost = $0.00",
    )
    rate_per_1m_in: float = Field(
        default=0.0, description="Input token rate applied (USD per 1M tokens)"
    )
    rate_per_1m_out: float = Field(
        default=0.0, description="Output token rate applied (USD per 1M tokens)"
    )


# ============================================================================
# Step 17: RAGAS Metrics Schema
# ============================================================================

class RAGASMetricsSchema(BaseModel):
    """
    RAGAS-inspired quality metrics computed from pipeline data.

    All four metrics are derived locally (zero LLM/network calls):
        faithfulness      — Fraction of grounded sentences [0, 1].
        answer_relevancy  — Query–answer keyword overlap [0, 1].
        context_precision — Mean source final_score [0, 1].
        context_recall    — Normalised source coverage [0, 1].
        overall_quality   — Weighted composite (0.35/0.25/0.25/0.15) [0, 1].

    Step 17 acceptance criterion:
        Every RAGResponse carries a ragas_metrics block inside audit_trail
        so compliance can detect quality regressions without replaying queries.
    """

    faithfulness: float = Field(
        ..., ge=0.0, le=1.0,
        description="Fraction of sentences with ≥1 valid [K:N] citation",
    )
    answer_relevancy: float = Field(
        ..., ge=0.0, le=1.0,
        description="Keyword overlap between query tokens and answer tokens",
    )
    context_precision: float = Field(
        ..., ge=0.0, le=1.0,
        description="Mean final_score of used source documents",
    )
    context_recall: float = Field(
        ..., ge=0.0, le=1.0,
        description="Normalised source coverage (source_count / target)",
    )
    overall_quality: float = Field(
        ..., ge=0.0, le=1.0,
        description="Weighted composite quality score",
    )
    computed_at: datetime = Field(
        ..., description="UTC timestamp when metrics were computed"
    )


# ============================================================================
# Step 17: Audit Trail Schema
# ============================================================================

class AuditTrailSchema(BaseModel):
    """
    Tamper-evident audit record attached to every RAGResponse.

    Satisfies the Step 17 acceptance criterion:
        "Sistem her cevabında; why-this-answer logu, kullanılan kaynak
        sürümleri, model kararı ve tool çağrıları şifreli kaydedilir."

    Fields:
        request_id          — UUID4 for this specific request.
        timestamp_utc       — UTC datetime the entry was created.
        query_hash          — SHA-256 of the raw query (KVKK: no raw text).
        bureau_id           — Tenant bureau UUID or None (public access).
        tier                — LLM tier used (1–4).
        model_used          — Full model label.
        source_count        — Number of source documents used by the LLM.
        tool_calls_made     — Deterministic tools invoked (Step 14).
        grounding_ratio     — Fraction of grounded sentences [0, 1].
        disclaimer_severity — "INFO" | "WARNING" | "CRITICAL".
        latency_ms          — End-to-end request latency.
        cost_estimate       — Per-request cost breakdown.
        ragas_metrics       — Quality metric snapshot.
        why_this_answer     — Human-readable routing + source reasoning log.
        audit_signature     — HMAC-SHA256 hex covering core fields.
    """

    request_id: str = Field(..., description="UUID4 for this request")
    timestamp_utc: datetime = Field(..., description="UTC creation timestamp")
    query_hash: str = Field(
        ..., description="SHA-256 hex of the raw query (KVKK-safe, no PII)"
    )
    bureau_id: Optional[str] = Field(
        None, description="Tenant bureau UUID or None for public access"
    )
    tier: int = Field(..., ge=1, le=4, description="LLM tier used (1–4)")
    model_used: str = Field(..., description="Full model label")
    source_count: int = Field(..., ge=0, description="Number of source documents")
    tool_calls_made: List[str] = Field(
        default_factory=list,
        description="Names of deterministic tools invoked (Step 14)",
    )
    tool_errors: List[str] = Field(
        default_factory=list,
        description="Names of deterministic tools that errored (logged + skipped, Step 14)",
    )
    docs_summarized_count: int = Field(
        default=0,
        description="Number of secondary documents compressed by ContextSummarizer (Step 15)",
    )
    tokens_saved: int = Field(
        default=0,
        description="Approximate tokens saved by secondary doc summarisation (Step 15)",
    )
    litm_applied: bool = Field(
        default=False,
        description="True when Lost-in-the-Middle context reordering was applied (Step 15)",
    )
    grounding_ratio: float = Field(
        ..., ge=0.0, le=1.0,
        description="Fraction of grounded sentences from ZeroTrust report",
    )
    disclaimer_severity: str = Field(
        ..., description="Legal disclaimer severity: INFO | WARNING | CRITICAL"
    )
    latency_ms: int = Field(..., ge=0, description="End-to-end latency in ms")
    cost_estimate: Optional[CostEstimateSchema] = Field(
        None, description="Per-request cost breakdown"
    )
    ragas_metrics: Optional[RAGASMetricsSchema] = Field(
        None, description="RAGAS-inspired quality metrics"
    )
    why_this_answer: str = Field(
        ..., description="Human-readable routing + source reasoning (KVKK-safe)"
    )
    audit_signature: str = Field(
        ..., description="HMAC-SHA256 hex covering core fields for tamper detection"
    )


# ============================================================================
# AYM Warning Schema  (Step 4 — Granüler Sürümleme + AYM İptal Yönetimi)
# ============================================================================

class AymWarningSchema(BaseModel):
    """
    Mandatory AYM cancellation/restriction warning for a single legal source.

    Surfaced to the API caller whenever a retrieved document carries an
    AYM cancellation status (IPTAL_EDILDI, IPTAL_EDILDI_ERTELENDI, KISMI_IPTAL).
    The UI MUST display ``warning_text`` prominently next to the cited source.

    Generated by RAGService from ``LegalDocument.aym_warning_text``.
    """

    document_id: str = Field(..., description="UUID of the cancelled/restricted document")
    citation: Optional[str] = Field(None, description="Short citation of the document")
    aym_iptal_durumu: str = Field(
        ...,
        description="AYM cancellation status: IPTAL_EDILDI|IPTAL_EDILDI_ERTELENDI|KISMI_IPTAL",
    )
    aym_karar_no: Optional[str] = Field(
        None, description="AYM decision number, e.g. '2023/45 E., 2024/78 K.'"
    )
    aym_karar_tarihi: Optional[date] = Field(
        None, description="Date the AYM issued its cancellation decision"
    )
    iptal_yururluk_tarihi: Optional[date] = Field(
        None,
        description="Date the cancellation takes effect (None = immediate)",
    )
    warning_text: str = Field(
        ..., description="Pre-computed Turkish-language mandatory warning text"
    )
    is_currently_effective: bool = Field(
        ...,
        description="True if the provision is still in legal force today",
    )


# ============================================================================
# Lehe Kanun Notice Schema  (Step 10 — Time-Travel Search ve Leşe Kanun)
# ============================================================================

class LeheKanunNoticeSchema(BaseModel):
    """
    Mandatory notice attached to RAGResponse when the lehe kanun (favor rei)
    principle is activated.

    Surfaced to the API caller when:
        - The query is in the criminal / administrative penalty / tax penalty domain
        - Both event_date and decision_date differ

    The UI MUST display this notice prominently with the disclaimer that
    the lawyer must compare both versions and apply the more favourable one.

    Legal basis: TCK Madde 7/2 (lehe kanun / in dubio mitius)
    """

    law_domain: str = Field(
        ...,
        description="Detected legal domain: CEZA | IDARI_CEZA | VERGI_CEZA",
    )
    event_date: date = Field(
        ..., description="Date the legal event / offence occurred"
    )
    decision_date: date = Field(
        ..., description="Date of verdict / comparison reference date"
    )
    event_doc_count: int = Field(
        0, ge=0,
        description="Number of documents retrieved at event_date",
    )
    decision_doc_count: int = Field(
        0, ge=0,
        description="Number of documents retrieved at decision_date",
    )
    reason: str = Field(
        ..., description="Turkish-language explanation of why lehe kanun applies"
    )
    legal_basis: str = Field(
        default="TCK Madde 7/2 — Lehe kanun ilkesi",
        description="Statutory basis for the comparison requirement",
    )
    disclaimer: str = Field(
        default=(
            "⚠️ LEHE KANUN: Her iki yasa sürümü getirilmiştir. "
            "Avukatınız TCK md. 7/2 gereği faili lehine olan sürümü "
            "belirlemelidir."
        ),
        description="Mandatory UI disclaimer text",
    )


# ============================================================================
# Source Document  (Step 2 — Kaynak Envanteri)
# ============================================================================

class SourceDocumentSchema(BaseModel):
    """
    A single retrieved legal document included in a RAG response.

    Provenance fields (source_url, version, collected_at) are surfaced to
    the caller for full auditability.  They are typed Optional only because
    rows created before the V2.1 migration may lack them — the RAGService
    already emits a provenance WARNING for such documents.

    STEP 3 (Hukuki Kanonik Veri Modeli):
        authority_score, majority_type, dissent_present, norm_hierarchy,
        chamber, and is_binding_precedent are surfaced so the UI can display
        the legal weight of each cited source.
    """

    id: str = Field(..., description="Document UUID")
    content: str = Field(..., description="Chunk text passed to the LLM as context")
    citation: Optional[str] = Field(
        None, description="Short canonical citation, e.g. 'Yargıtay 2 HD, E.2023/1234'"
    )
    court_level: Optional[str] = Field(None, description="CourtLevel enum value")
    ruling_date: Optional[date] = Field(
        None, description="Date of ruling or law's enactment date"
    )

    # ── Step 2: Provenance fields ─────────────────────────────────────────────
    source_url: Optional[str] = Field(
        None, description="Canonical URL of the original legal source"
    )
    version: Optional[str] = Field(
        None, description="Source version / effective date (YYYY-MM-DD or decision number)"
    )
    collected_at: Optional[datetime] = Field(
        None, description="Ingestion timestamp — provenance anchor"
    )

    # ── Step 3: Authority model fields ────────────────────────────────────────
    norm_hierarchy: Optional[str] = Field(
        None, description="Norm hierarchy tier: ANAYASA|KANUN|CBK|YONETMELIK|TEBLIG|DIGER"
    )
    chamber: Optional[str] = Field(
        None, description="Court chamber / daire name, e.g. '9. Hukuk Dairesi'"
    )
    majority_type: Optional[str] = Field(
        None, description="Voting outcome: OY_BIRLIGI|OY_COKLUGU|KARSI_OY"
    )
    dissent_present: bool = Field(
        False, description="True if a dissenting opinion is noted in the decision"
    )
    authority_score: float = Field(
        0.0, ge=0.0, le=1.0,
        description="Computed authority score combining court level, majority type and dissent"
    )
    is_binding_precedent: bool = Field(
        False, description="True for AYM/IBK/HGK/CGK/DANISTAY_IDDK binding decisions"
    )

    # ── Step 4: Granular versioning + AYM cancellation ────────────────────────
    effective_date: Optional[date] = Field(
        None, description="Date this provision entered into force"
    )
    expiry_date: Optional[date] = Field(
        None, description="Date this version was superseded (None = still in force)"
    )
    aym_iptal_durumu: Optional[str] = Field(
        None,
        description="AYM cancellation status: YURURLUKTE|IPTAL_EDILDI|IPTAL_EDILDI_ERTELENDI|KISMI_IPTAL",
    )
    iptal_yururluk_tarihi: Optional[date] = Field(
        None, description="Date the AYM cancellation takes effect"
    )
    aym_karar_no: Optional[str] = Field(
        None, description="AYM decision number, e.g. '2023/45 E., 2024/78 K.'"
    )
    aym_karar_tarihi: Optional[date] = Field(
        None, description="Date of the AYM decision"
    )
    aym_warning: str = Field(
        "",
        description="Pre-computed mandatory AYM warning text (empty string if no warning)",
    )
    # ── Step 5: Ingest / Parsing metadata ─────────────────────────────────────────────
    segment_type: Optional[str] = Field(
        None,
        description="SegmentType: MADDE|FIKRA|ICTIHAT_HEADER|ICTIHAT_BODY|ICTIHAT_HUKUM|FULL",
    )
    madde_no: Optional[str] = Field(
        None, description="Article number, e.g. '17' or '17/A'"
    )
    fikra_no: Optional[int] = Field(
        None, description="Paragraph number within article"
    )
    document_type: Optional[str] = Field(
        None, description="DocumentType: MEVZUAT|ICTIHAT|UNKNOWN"
    )

    # ── Step 6: Multi-tenancy ─────────────────────────────────────────────────────
    bureau_id: Optional[str] = Field(
        None,
        description="Bureau UUID that owns this document (None = public content)",
    )

    # ── Step 10: Lehe Kanun version tag ───────────────────────────────────────
    version_type: Optional[str] = Field(
        None,
        description=(
            "Step 10 lehe kanun: 'EVENT_DATE' = law in force when offence occurred; "
            "'DECISION_DATE' = law in force when verdict is rendered. "
            "None = standard (non-lehe) retrieval."
        ),
    )
    # ── Step 12: Lex Specialis / Lex Posterior çatışma notları ───────────────
    conflict_notes: List[str] = Field(
        default_factory=list,
        description=(
            "Step 12: Lex Specialis veya Lex Posterior kuralının uygulandığı "
            "durumlarda hangi belgenin öncelikli olduğunu açıklayan notlar."
        ),
    )
    # ── Relevance score ───────────────────────────────────────────────────────
    final_score: float = Field(..., ge=0.0, le=1.0, description="Hybrid relevance score [0–1]")

    model_config = {"from_attributes": True}


# ============================================================================
# RAG Query Request
# ============================================================================

class RAGQueryRequest(BaseModel):
    """Incoming query payload from the client."""

    query: str = Field(
        ..., min_length=3, max_length=2000, description="User's legal question"
    )
    case_id: Optional[str] = Field(
        None, description="Scope retrieval to a specific case UUID"
    )
    max_sources: int = Field(
        default=8, ge=1, le=20, description="Max number of sources to retrieve"
    )
    min_score: float = Field(
        default=0.25, ge=0.0, le=1.0, description="Minimum hybrid relevance score threshold"
    )
    event_date: Optional[date] = Field(
        None,
        description=(
            "Optional: retrieve the version of each law in force on this date. "
            "Enables time-travel queries for past legal events. "
            "Format: YYYY-MM-DD.  None = use latest version."
        ),
    )
    decision_date: Optional[date] = Field(
        None,
        description=(
            "Step 10: Date of the criminal verdict / administrative decision. "
            "When provided together with event_date, activates the lehe kanun engine: "
            "retrieves both versions (event + decision) for TCK md. 7/2 comparison. "
            "Must be >= event_date."
        ),
    )
    bureau_id: Optional[str] = Field(
        None,
        description=(
            "Step 6: Bureau UUID for tenant isolation. "
            "When set, retrieval is scoped to public documents + this bureau's private documents. "
            "In production, extracted from TenantMiddleware request.state.tenant."
        ),
    )
    seniority_years: Optional[float] = Field(
        None,
        ge=0.0,
        le=50.0,
        description=(
            "Step 14: İşçinin kıdem yılı (ondalık). "
            "Belirtildiğinde ToolDispatcher, İş K. md. 17 ihbar süresi hesabında "
            "doğru tier'ı (14/28/42/56 gün) otomatik seçer. "
            "Ör: 2.5 → kıdem 2.5 yıl → IS_AKDI_IHBAR_18AY (42 gün). "
            "Belirtilmezse keyword eşleşmesiyle varsayılan tier kullanılır."
        ),
    )


# ============================================================================
# Step 16: Auto-disclaimer helper (used by RAGResponse model_validator)
# ============================================================================

def _auto_disclaimer(
    has_aym: bool = False,
    has_lehe: bool = False,
    grounding_hard_fail: bool = False,
) -> "LegalDisclaimerSchema":
    """
    Generates a minimal LegalDisclaimerSchema without importing disclaimer_engine.

    Called by RAGResponse.enforce_sources_present() when legal_disclaimer is
    absent (e.g. tests that construct RAGResponse directly without calling
    RAGService).  Production code always provides a full disclaimer from
    LegalDisclaimerEngine.generate().

    Note: In the schema-level validator, grounding_ratio is not available on
    RAGResponse; callers that need DUSUK_GROUNDING in the fallback must pass
    grounding_hard_fail=True explicitly.  In production, RAGService always
    provides a pre-built disclaimer that already includes DUSUK_GROUNDING.
    """
    types: List[str] = ["GENEL_HUKUKI"]
    severity = "INFO"
    text = (
        "\u2696\ufe0f HUKUK\u0130 UYARI: Bu sistem yapay zeka destekli bir hukuki bilgi "
        "arac\u0131d\u0131r. Sunulan bilgiler hukuki tavsiye niteli\u011fi ta\u015f\u0131maz ve bir "
        "avukat g\u00f6r\u00fc\u015f\u00fcn\u00fcn yerini tutamaz. Avukatl\u0131k Kanunu md. 35 gere\u011fi "
        "hukuki dan\u0131\u015fmanl\u0131k yaln\u0131zca avukatlar taraf\u0131ndan verilebilir."
    )
    if has_aym:
        types.append("AYM_IPTAL_UYARISI")
        severity = "CRITICAL"
        text += (
            "\n\n\U0001f6a8 AYM \u0130PTAL UYARISI: Yan\u0131tta at\u0131fta bulunulan kaynaklardan "
            "bir veya birka\u00e7\u0131 Anayasa Mahkemesi taraf\u0131ndan iptal edilmi\u015f veya "
            "k\u0131s\u0131tlanm\u0131\u015ft\u0131r. G\u00fcncel mevzuat\u0131 bizzat inceleyiniz."
        )
    if has_lehe:
        types.append("LEHE_KANUN")
        if severity == "INFO":
            severity = "WARNING"
        text += (
            "\n\n\u26a0\ufe0f LEHE KANUN (TCK md. 7/2): Lehe kanun de\u011ferlendirmesi "
            "yaln\u0131zca yetkili hukuk uzman\u0131nca ger\u00e7ekle\u015ftirilebilir."
        )
    if grounding_hard_fail:
        types.append("DUSUK_GROUNDING")
        severity = "CRITICAL"
        text += (
            "\n\n\U0001f6ab D\u00dc\u015e\u00dcK GROUNDING UYARISI: Bu yan\u0131ttaki ifadelerin "
            "\u00f6nemli bir k\u0131sm\u0131 kaynak belgelerde yeterince desteklenmemektedir. "
            "Bu bilgilere dayanarak herhangi bir hukuki i\u015flem yapmadan \u00f6nce "
            "mutlaka alan\u0131nda uzman bir avukata dan\u0131\u015f\u0131n\u0131z."
        )
    return LegalDisclaimerSchema(
        disclaimer_text=text,
        disclaimer_types=types,
        severity=severity,
        requires_expert_review=False,
        generated_at=datetime.now(tz=timezone.utc),
        legal_basis="Avukatl\u0131k Kanunu md. 35 | TBB Meslek Kurallar\u0131 md. 3",
    )


# ============================================================================
# RAG Response  —  HARD-FAIL enforced (Step 1)
# ============================================================================

class RAGResponse(BaseModel):
    """
    Final response returned to the client after a successful RAG query.

    STEP 1 ENFORCEMENT:
        The @model_validator below makes it structurally IMPOSSIBLE to return
        a RAGResponse without at least one source document.  If — despite the
        primary guard in RAGService — an empty sources list somehow reaches
        this validator, a ValueError is raised and the response is blocked.

    STEP 2 ENFORCEMENT:
        Each element in `sources` carries provenance metadata (source_url,
        version, collected_at).  Documents lacking collected_at are flagged
        in the server logs as PROVENANCE_WARN.
    """

    answer: str = Field(
        ..., description="LLM-generated answer grounded in retrieved sources"
    )
    sources: List[SourceDocumentSchema] = Field(
        ...,
        min_length=1,   # Pydantic v2 constraint — list MUST contain ≥ 1 element
        description="Supporting legal documents. MUST be non-empty (Step 1 Hard-Fail).",
    )
    query: str = Field(..., description="Echo of the original query (for audit trail)")
    model_used: str = Field(..., description="LLM tier + model ID that generated the answer")
    retrieval_count: int = Field(..., ge=1, description="Number of documents retrieved")
    latency_ms: int = Field(..., ge=0, description="End-to-end request latency in milliseconds")

    # ── Step 4: AYM cancellation warnings ────────────────────────────────────
    aym_warnings: List[AymWarningSchema] = Field(
        default_factory=list,
        description="Mandatory AYM cancellation/restriction warnings for retrieved sources",
    )
    # ── Step 10: Lehe Kanun notice ──────────────────────────────────────────────
    lehe_kanun_notice: Optional[LeheKanunNoticeSchema] = Field(
        None,
        description=(
            "Step 10: Populated when lehe kanun (TCK md. 7/2) is activated. "
            "Contains both-version notice and mandatory disclaimer for the UI."
        ),
    )

    # ── Step 16: Zero-Trust Generation — inline citations ─────────────────────
    answer_sentences: List[AnswerSentence] = Field(
        default_factory=list,
        description=(
            "Step 16: The answer split into sentences, each tagged with the "
            "source indices ([K:N]) it cites.  Enables single-click verification."
        ),
    )
    inline_citations: List[InlineCitation] = Field(
        default_factory=list,
        description=(
            "Step 16: Maps each cited sentence to concrete source document UUIDs "
            "for deep-linking from the UI."
        ),
    )

    # ── Step 16: Mandatory legal disclaimer ───────────────────────────────────
    legal_disclaimer: Optional[LegalDisclaimerSchema] = Field(
        None,
        description=(
            "Step 16: Mandatory legal disclaimer.  Auto-generated by the "
            "model_validator if not explicitly provided.  NEVER None in the "
            "final serialised response."
        ),
    )

    # ── Step 17: Audit Trail ───────────────────────────────────────────────
    audit_trail: Optional[AuditTrailSchema] = Field(
        None,
        description=(
            "Step 17: Tamper-evident audit record. Contains why-this-answer "
            "log, source versions, model decision, tool calls, cost estimate, "
            "RAGAS metrics, and HMAC-SHA256 integrity signature."
        ),
    )

    @computed_field
    @property
    def has_cancelled_sources(self) -> bool:
        """True when at least one retrieved source carries a mandatory AYM warning."""
        return len(self.aym_warnings) > 0

    @model_validator(mode="after")
    def enforce_sources_present(self) -> "RAGResponse":
        """
        STEP 1 — HARD-FAIL: Kaynak yoksa cevap yok.

        Validates:
            1. sources list is non-empty (belt-and-suspenders on top of min_length=1).
            2. Logs a WARNING for each source missing collected_at (provenance gap).
        """
        # Guard 1: Non-empty list
        if not self.sources:
            logger.error("HARD_FAIL: RAGResponse constructed with empty sources list.")
            raise ValueError(
                "Kaynak yoksa cevap yok: "
                "En az 1 hukuki kaynak belgelenmeden yanıt üretilemez. "
                "[Step 1 Hard-Fail Policy]"
            )

        # Guard 2: Provenance audit warning
        unverifiable = [s for s in self.sources if s.collected_at is None]
        if unverifiable:
            logger.warning(
                "PROVENANCE_WARN: %d/%d source(s) lack 'collected_at'. "
                "Doc ids: %s",
                len(unverifiable),
                len(self.sources),
                [s.id for s in unverifiable],
            )

        # Guard 3: AYM cancellation warning log (Step 4)
        if self.aym_warnings:
            logger.warning(
                "AYM_WARNING: %d source(s) carry mandatory AYM cancellation warnings. "
                "Doc ids: %s",
                len(self.aym_warnings),
                [w.document_id for w in self.aym_warnings],
            )

        # Guard 4: Step 16 — Auto-generate legal disclaimer if absent.
        #   In production, RAGService always provides a full disclaimer.
        #   This fallback ensures tests and schema-only usage still get one.
        if self.legal_disclaimer is None:
            self.legal_disclaimer = _auto_disclaimer(
                has_aym=bool(self.aym_warnings),
                has_lehe=self.lehe_kanun_notice is not None,
            )
            logger.debug(
                "DISCLAIMER_AUTO_GENERATED | severity=%s | types=%s",
                self.legal_disclaimer.severity,
                self.legal_disclaimer.disclaimer_types,
            )

        return self


# ============================================================================
# Error Response Schemas
# ============================================================================

class NoSourceErrorDetail(BaseModel):
    """
    Structured error payload returned when the Hard-Fail gate is triggered.
    HTTP status: 422 Unprocessable Entity.
    """

    error_code: str = Field(default="NO_SOURCE_HARD_FAIL")
    message: str = Field(
        default=(
            "Kaynak yoksa cevap yok: "
            "Bu sorgu için yeterli hukuki kaynak bulunamadı."
        )
    )
    query: str
    llm_called: bool = Field(
        default=False,
        description="LLM was NOT invoked — cost for this request = $0",
    )
    suggestion: str = Field(
        default="Lütfen sorunuzu daha spesifik hukuki terimlerle yeniden deneyin."
    )


class PromptInjectionErrorDetail(BaseModel):
    """
    Structured error payload returned when the Prompt Injection Guard fires.
    HTTP status: 400 Bad Request.

    STEP 5 — Prompt Injection Guard:
        The LLM is NEVER called when this error is returned.
        Cost for this request = $0.

    Fields:
        error_code:      Always "PROMPT_INJECTION_DETECTED".
        threat_type:     JAILBREAK | ROLE_OVERRIDE | SYSTEM_PROMPT_LEAK |
                         CONTEXT_POISONING | ENCODED_INJECTION
        location:        "query" (user input scan) or "context" (document
                         poisoning scan).
        llm_called:      Always False — LLM was blocked before invocation.
    """

    error_code: str = Field(default="PROMPT_INJECTION_DETECTED")
    message: str = Field(
        default=(
            "İstek güvenlik denetiminden geçemedi: "
            "zararlı içerik tespit edildi. "
            "LLM çağrısı yapılmadı."
        )
    )
    threat_type: Optional[str] = Field(
        None,
        description="Category of the detected injection threat",
    )
    location: str = Field(
        default="query",
        description="Scan surface that triggered: 'query' or 'context'",
    )
    llm_called: bool = Field(
        default=False,
        description="LLM was NOT invoked — cost for this request = $0",
    )


class APIErrorResponse(BaseModel):
    """Standard error envelope for all non-2xx API responses."""

    success: bool = False
    detail: Dict[str, Any]
    request_id: Optional[str] = None
