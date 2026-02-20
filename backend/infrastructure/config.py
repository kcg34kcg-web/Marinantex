"""
Configuration Management for Babylexit v3.0
Loads environment variables with validation and type safety.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    Uses Pydantic for validation and type safety.
    """
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    
    # ========================================================================
    # Database (Supabase)
    # ========================================================================
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_anon_key: Optional[str] = None
    database_url: str = ""  # Direct Postgres connection for checkpointer
    
    # ========================================================================
    # Redis
    # ========================================================================
    redis_url: str = "redis://localhost:6379"
    redis_password: Optional[str] = None
    
    # ========================================================================
    # LLM Providers
    # ========================================================================
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    
    # ========================================================================
    # Privacy & Security
    # ========================================================================
    pii_encryption_key: str = ""
    jwt_secret_key: str = "dev-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 30
    
    # ========================================================================
    # Application
    # ========================================================================
    environment: str = "development"
    log_level: str = "info"
    debug: bool = False
    
    # Rate limiting
    rate_limit_per_minute: int = 60
    rate_limit_burst: int = 10
    
    # ========================================================================
    # Step 6: Query Embedding (OpenAI text-embedding-3-small)
    # ========================================================================
    embedding_model: str = "text-embedding-3-small"
    """OpenAI embedding model.  text-embedding-3-small: 1536 dims, $0.02/1M tokens.
    Override via EMBEDDING_MODEL env var for local/alternative models."""

    embedding_dimensions: int = 1536
    """Vector dimension produced by the embedding model.
    Must match the pgvector(N) column in the documents table."""

    embedding_batch_size: int = 512
    """Max texts per OpenAI embeddings API call (ingest pipeline).
    OpenAI recommends ≤2048 strings or ≤8191 tokens per request."""

    embedding_max_retries: int = 3
    """Number of retry attempts on RateLimitError / 5xx before giving up."""

    embedding_retry_base_delay_s: float = 1.0
    """Base delay in seconds for exponential back-off.
    Attempt k sleeps for base_delay * 2^(k-1) seconds."""

    turkish_ner_model: Optional[str] = None
    
    # ========================================================================
    # LangGraph
    # ========================================================================
    checkpoint_table_name: str = "langgraph_checkpoints"
    
    # ========================================================================
    # Feature Flags
    # ========================================================================
    enable_privacy_middleware: bool = True
    enable_semantic_router: bool = True
    enable_time_travel: bool = False

    # ========================================================================
    # Step 3: Semantic Cache (Redis-backed)
    # ========================================================================
    semantic_cache_enabled: bool = True
    """Master switch — set False to disable cache entirely without code change."""

    semantic_cache_ttl_seconds: int = 86400
    """Cache TTL in seconds.  Default 24 h (Turkish law doesn't change hourly).
    Decrease if the knowledge base is ingested more frequently."""

    semantic_cache_similarity_threshold: float = 0.92
    """Cosine similarity threshold for L2 (semantic) cache hits.
    0.92 = highly similar queries treated as equivalent.
    Lower = more aggressive caching; higher = stricter match required."""

    semantic_cache_max_l2_entries: int = 200
    """Max L2 entries kept in the Redis index list.
    Bounds the O(N) cosine scan to at most N comparisons per lookup."""

    # ========================================================================
    # Step 4: Tiered LLM Router
    # ========================================================================
    llm_tier1_model: str = "llama-3.3-70b-versatile"
    """Tier 1 — Groq inference.  Target: $0.001 / 1-2 s.
    Used for simple factual queries with short context."""

    llm_tier2_model: str = "gpt-4o-mini"
    """Tier 2 — OpenAI.  Target: ~$0.01 / 4-6 s.
    Standard queries, moderate context length."""

    llm_tier3_model: str = "gpt-4o"
    """Tier 3 — OpenAI.  Target: ~$0.05-0.10 / 10-15 s.
    Multi-article analysis, case-law reasoning."""

    llm_tier4_model: str = "claude-3-5-sonnet-20241022"
    """Tier 4 — Anthropic.  Target: ~$0.50+ / 30-90 s.
    AYM decisions, detailed legal memos, largest context windows."""

    llm_tier4_use_reasoning: bool = False
    """When True, Tier 4 uses OpenAI reasoning models (o1 / o3-mini) instead
    of Anthropic Claude.  Requires OPENAI_API_KEY.
    Default False — Claude remains the Tier 4 provider until explicitly enabled.
    Override via LLM_TIER4_USE_REASONING=true env var."""

    llm_tier4_reasoning_model: str = "o3-mini"
    """OpenAI reasoning model used when llm_tier4_use_reasoning=True.
    Supported: 'o3-mini' (~$1.10/$4.40 per 1M tokens — best cost/quality),
               'o1'      (~$15.00/$60.00 per 1M tokens — maximum reasoning),
               'o1-mini' (~$3.00/$12.00 per 1M tokens — fast reasoning).
    Override via LLM_TIER4_REASONING_MODEL env var."""

    llm_tier4_reasoning_effort: str = "medium"
    """Reasoning effort level for o3-mini (ignored for o1 / o1-mini).
    Values: 'low' | 'medium' | 'high'.
    'high' produces deepest legal reasoning but highest latency and cost (~2× medium).
    'medium' is recommended for Turkish legal analysis.
    Override via LLM_TIER4_REASONING_EFFORT env var."""

    llm_tier4_multi_agent_enabled: bool = False
    """When True, Tier 4 queries run through the Researcher → Critic → Synthesizer
    multi-agent pipeline instead of a single direct LLM call.
    Compatible with both Claude (standard) and o3-mini (reasoning) backends.
    Increases latency by ~3× but significantly reduces hallucination rate.
    Override via LLM_TIER4_MULTI_AGENT_ENABLED=true env var."""

    # Context-token thresholds that trigger tier promotion
    llm_tier1_max_context_tokens: int = 800
    """Max context tokens before promoting from Tier 1 → Tier 2."""

    llm_tier2_max_context_tokens: int = 2500
    """Max context tokens before promoting from Tier 2 → Tier 3."""

    llm_tier3_max_context_tokens: int = 5000
    """Max context tokens before promoting from Tier 3 → Tier 4."""

    llm_max_response_tokens: int = 2048
    """Maximum tokens to generate in any LLM response."""
    # ========================================================================
    # Step 7: Retrieval Score Weights
    # ========================================================================
    retrieval_semantic_weight: float = 0.45
    """Weight for cosine-similarity semantic score [0, 1].
    Matches the SQL default. Tune here without a DB migration."""

    retrieval_keyword_weight: float = 0.30
    """Weight for BM25 ts_rank_cd keyword score [0, 1]."""

    retrieval_recency_weight: float = 0.10
    """Weight for recency decay score [0, 1]."""

    retrieval_hierarchy_weight: float = 0.15
    """Weight for court hierarchy score [0, 1]."""

    retrieval_keyword_score_cap: float = 1.0
    """Cap applied to raw BM25 scores before normalisation.
    ts_rank_cd can return values > 1.0 for dense keyword matches."""

    retrieval_must_cite_boost: float = 0.05
    """Score addend applied to must-cite documents injected from
    case_must_cites.  Forces them above nearby non-must-cite docs."""

    retrieval_binding_hard_boost: float = 0.20
    """Hard boost applied in Python to binding-precedent documents
    (AYM, YARGITAY_IBK, YARGITAY_HGK, YARGITAY_CGK, DANISTAY_IDDK).
    Mirrors the SQL binding_boost column in hybrid_legal_search.
    When recomputing final_score client-side this ensures binding
    decisions always rank above regular appellate results with the
    same semantic similarity.  Set to 0.0 to disable."""

    enable_citation_engine: bool = False
    enable_living_documents: bool = False

    # ========================================================================
    # Step 8: Context Builder — Token Budget Management
    # ========================================================================
    context_tier4_max_tokens: int = 8192
    """Context window budget for Tier 4 (Claude-3.5-sonnet / Anthropic).
    Claude supports 200k tokens, but we self-limit to keep prompts focused."""

    context_system_prompt_reserve_tokens: int = 200
    """Tokens reserved for the system prompt that precedes the context block.
    Prevents the system prompt from eating into the document budget."""

    context_query_reserve_tokens: int = 150
    """Tokens reserved for the user query appended after the context block.
    A typical Turkish legal query is ~30-80 tokens; 150 is a safe upper bound."""

    context_response_reserve_tokens: int = 512
    """Tokens reserved for the LLM response.
    Smaller than llm_max_response_tokens intentionally: we over-reserve on
    the generation side to avoid cut-off answers, but context can be fuller."""

    context_token_safety_margin: float = 0.10
    """Fractional safety buffer subtracted from the effective budget.
    Compensates for estimate_tokens() being approximate (1 token ≈ 4 chars).
    Range [0.0, 0.5].  Default 10 % keeps the context comfortably under limit."""

    context_min_snippet_chars: int = 80
    """Minimum characters for a soft-truncated snippet to be included.
    Snippets shorter than this are discarded to avoid noise-only fragments."""

    # ========================================================================
    # Step 5: Ingest / Parsing Pipeline
    # ========================================================================
    ingest_min_segment_chars: int = 50
    """Minimum character count for a parsed segment to be retained.
    Segments shorter than this are discarded as noise or header fragments."""

    ingest_madde_split_threshold: int = 4000
    """Character threshold at which a single MADDE segment is split into
    individual FIKRA-level sub-segments for better RAG chunking granularity."""

    ingest_high_ligature_threshold: int = 20
    """OCR quality warning: if more than this many ligature/special-char
    substitutions are performed, a WARNING is added to the IngestResult."""

    ingest_high_hyphen_threshold: int = 50
    """OCR quality warning: if more than this many line-break hyphens are
    rejoined, a WARNING is added (suggests narrow-column or scanned PDF)."""

    ingest_large_reduction_pct: float = 30.0
    """OCR quality warning: if text is reduced by more than this percentage
    during cleaning, a WARNING is emitted to surface possible input issues."""

    # ========================================================================
    # Step 6: KVKK Güvenliği ve Multi-Tenancy (Büro İzolasyonu)
    # ========================================================================
    multi_tenancy_enabled: bool = True
    """Master switch for bureau-level tenant isolation.
    Set False to disable all bureau filtering (single-tenant mode)."""

    tenant_header_name: str = "X-Bureau-ID"
    """HTTP header that carries the caller's bureau UUID.
    In production this should be derived from the Supabase JWT claims."""

    tenant_enforce_in_dev: bool = False
    """Set True to enforce bureau header validation even in development mode.
    When False (default), missing bureau_id is silently accepted in dev."""

    kvkk_redact_prompts: bool = True
    """When True, KVKKRedactor.redact() is applied to user queries before
    they are passed to the LLM.  Prevents PII from entering LLM context."""

    kvkk_redact_logs: bool = True
    """When True, KVKKRedactor.redact_for_log() is applied to any user-supplied
    text before it is written to structured logs."""

    # ========================================================================
    # Step 10: Time-Travel Search ve “Lehe Kanun” Motoru
    # ========================================================================
    lehe_kanun_enabled: bool = True
    """Master switch for the lehe kanun (TCK md. 7/2) rule engine.
    When True, queries with both event_date and decision_date in a criminal /
    administrative penalty / tax penalty domain trigger two-version retrieval.
    Set False to disable without code changes (single-version mode)."""

    lehe_kanun_deduplicate: bool = True
    """When True, documents that appear in BOTH the event_date and decision_date
    result sets are included only once (from the event_date set) to avoid
    context bloat when the two versions are nearly identical."""

    # ========================================================================
    # Step 11: Hibrit Arama (RRF) ve Asenkron İndeksleme
    # ========================================================================
    rrf_enabled: bool = True
    """Master switch for Reciprocal Rank Fusion hybrid search.
    When True, both vector and BM25 searches run and results are fused.
    When False, falls back to vector-only search (Step 7 behaviour)."""

    rrf_k: int = 60
    """RRF smoothing constant k (Cormack & al., 2009).
    Higher k = smaller gap between ranks → more conservative fusion.
    Default 60 is the empirically validated value for most IR tasks."""

    rrf_k_ceza: int = 40
    """Domain-specific RRF k for CEZA, IDARI_CEZA and VERGI_CEZA law domains.
    Lower k = steeper rank differentiation → more decisive fusion for
    dense ceza kanunu / TCK corpora.  Empirically ~40 outperforms 60 on
    criminal-law benchmark queries.
    Override via RRF_K_CEZA env var."""

    rrf_semantic_weight: float = 1.0
    """Multiplier applied to semantic (vector) search RRF scores.
    Values > 1.0 give semantic results an advantage in the fusion."""

    rrf_keyword_weight: float = 1.0
    """Multiplier applied to keyword (BM25) search RRF scores.
    Values > 1.0 give keyword results an advantage in the fusion."""

    synonym_expansion_enabled: bool = True
    """When True, BM25 queries are expanded with Turkish legal synonyms
    via SynonymStore before being submitted to hybrid_legal_search."""

    # ── Step 9: Sorgu Yeniden Yazımı ─────────────────────────────────────────
    query_rewrite_enabled: bool = True
    """Master switch for Step 9 query rewriting.
    When True, Tier 2+ queries are transformed from colloquial Turkish to
    formal legal terminology before embedding and retrieval.
    Set False to disable without code changes."""

    query_rewrite_model: str = "gpt-4o-mini"
    """OpenAI model used for query rewriting (Tier 2 cost level).
    Must be a chat completion model."""

    query_rewrite_timeout_s: float = 5.0
    """Maximum seconds to wait for the query rewriter LLM response.
    If exceeded, the original query is used (fallback — non-fatal)."""

    query_rewrite_min_tier: int = 2
    """Minimum preliminary tier required to activate query rewriting.
    Tier 1 queries are returned unchanged (pass-through, zero latency)."""

    # ── Celery / Asenkron İndeksleme ────────────────────────────────────────
    celery_broker_url: str = "redis://localhost:6379/1"
    """Celery message broker URL.
    Redis (default): redis://localhost:6379/1
    RabbitMQ:        amqp://user:pass@localhost:5672/vhost"""

    celery_result_backend: str = "redis://localhost:6379/2"
    """Celery result backend for task status / return values."""

    celery_task_always_eager: bool = False
    """When True, Celery tasks run synchronously in the calling process.
    Set True in test/dev environments to avoid needing a Celery worker."""

    celery_task_max_retries: int = 3
    """Maximum number of automatic task retries on failure."""

    celery_task_retry_delay_s: int = 5
    """Delay in seconds between task retry attempts."""

    # ========================================================================
    # Step 12: Hiyerarşi, Otorite ve Çatışma Duyarlı Re-Ranking
    # ========================================================================
    reranking_enabled: bool = True
    """Master switch for the LegalReranker.
    When True, retrieval results are re-ranked by norm hierarchy, authority
    score, and Lex Specialis / Lex Posterior rules after RRF fusion.
    When False, RRF order is preserved (pass-through)."""

    reranking_authority_weight: float = 0.10
    """Multiplier applied to doc.authority_score in the reranker.
    doc.authority_score ∈ [0, 1.0] (IBK=1.0, AYM=1.0, Daire=0.75, ...)
    Effective boost = authority_score × reranking_authority_weight."""

    reranking_hierarchy_weight: float = 1.0
    """Multiplier applied to the _NORM_BOOST table values.
    _NORM_BOOST: ANAYASA=0.20, KANUN=0.12, CBK=0.08, YONETMELIK=0.04 ...
    Effective boost = _NORM_BOOST[norm_hierarchy] × reranking_hierarchy_weight."""

    reranking_binding_boost: float = 0.10
    """Hard boost applied to binding-precedent documents (AYM, IBK, HGK, CGK,
    DANISTAY_IDDK) in the re-ranking layer.
    Separate from retrieval_binding_hard_boost (applied in retrieval layer)
    to allow independent tuning of each pipeline stage."""

    lex_specialis_weight: float = 0.10
    """Boost applied when Lex Specialis rule fires.
    A document from a domain-specialised court chamber receives this boost
    over a general-court document at the same norm hierarchy level."""

    lex_posterior_weight: float = 0.06
    """Boost applied when Lex Posterior rule fires.
    A document with a later effective_date or ruling_date receives this boost
    over an older document at the same norm hierarchy level."""

    # ========================================================================
    # Step 13: GraphRAG — Atıf Zinciri ve Derinlik Sınırı
    # ========================================================================
    graphrag_enabled: bool = True
    """Master switch for GraphRAG citation chain expansion.
    When True, Tier 3/4 queries trigger BFS expansion of the citation graph
    to find related documents cited by retrieved results.
    Set False to disable without code changes (retrieval-only mode)."""

    graphrag_max_depth: int = 2
    """Maximum BFS depth for citation traversal.
    depth=0 → root docs only (no expansion).
    depth=1 → root + directly cited docs.
    depth=2 → root + cited docs + docs cited by cited docs.
    MUST NOT exceed 2 (spec constraint) — prevents token cost explosion."""

    graphrag_max_nodes: int = 15
    """Maximum total nodes (documents) in the citation graph.
    Acts as a token-budget guard: limits how many extra documents can be
    added to the context via citation expansion."""

    graphrag_min_tier: int = 3
    """Minimum query tier required to activate GraphRAG expansion.
    Default 3 = Tier 3 (GPT-4o) and above.
    Tier 1/2 queries return root documents unchanged (no expansion cost)."""

    # ========================================================================
    # Step 14: Agentic Tool Calling — Matematik/Süre Hesabı
    # ========================================================================
    agentic_tools_enabled: bool = True
    """Master switch for deterministic legal tool calling (Step 14).
    When True, Tier 3/4 queries are scanned for deadline-calculation intent;
    matched tools run deterministically and their results are injected into
    the LLM context BEFORE the answer is generated.
    Set False to disable without code changes (LLM-only mode)."""

    agentic_tools_min_tier: int = 3
    """Minimum query tier required to activate agentic tool calling.
    Default 3 = Tier 3 (GPT-4o) and above.
    Tier 1/2 queries skip tool detection (cost optimisation)."""

    # ========================================================================
    # Step 15: Context Budget + “Lost in the Middle” Kontrolü
    # ========================================================================
    context_litm_reorder_enabled: bool = True
    """When True, documents passed to ContextBuilder.build() are reordered
    using the Lost-in-the-Middle algorithm: highest-scoring docs are placed
    at the edges of the context window where the LLM attends best.
    Set False to restore original score-descending order."""

    context_summarization_enabled: bool = True
    """Master switch for secondary document summarisation (Step 15).
    When True and the query tier is ≥ context_summarization_min_tier,
    documents beyond the primary_count are compressed with
    ContextSummarizer before being included in the context window.
    Set False to keep full document content (may drop low-score docs instead)."""

    context_summarization_min_tier: int = 4
    """Minimum query tier required to activate secondary doc summarisation.
    Default 4 = Tier 4 (MUAZZAM) only.  Tier 1/2/3 use full doc content."""

    context_summary_target_tokens: int = 200
    """Target token length for each compressed secondary document summary.
    The summariser attempts to produce output of approximately this length.
    Actual length may vary ±10 % depending on LLM output or extractive
    truncation boundaries."""

    context_summarization_primary_count: int = 3
    """Number of top-ranked (primary) documents to keep at FULL content.
    Documents beyond this rank are treated as secondary and eligible for
    summarisation when context_summarization_enabled=True.
    Set 0 to summarise all documents (not recommended)."""

    # ========================================================================
    # Step 17: CI/CD Kalite Kapısı, Cost ve Hukuki Denetim İzi
    # ========================================================================
    audit_trail_enabled: bool = True
    """Master switch for the legal audit trail (Step 17).
    When True, every RAGResponse carries a tamper-evident LegalAuditEntry
    with why-this-answer log, source versions, model decision, tool calls,
    and HMAC-SHA256 signature.
    Set False to disable audit recording without code changes."""

    cost_tracking_enabled: bool = True
    """Master switch for per-request cost estimation (Step 17).
    When True, CostTracker.estimate() is called for every non-cached request
    and the CostEstimate is attached to the audit_trail.
    Set False to skip cost computation (marginal performance gain in tests)."""

    ragas_metrics_enabled: bool = True
    """Master switch for RAGAS-inspired quality metrics (Step 17).
    When True, RAGASAdapter.compute() is called after each response and
    the RAGASMetrics are attached to the audit_trail.
    Set False to skip metric computation."""

    zero_trust_min_grounding_ratio: float = 0.5
    """Post-LLM grounding gate threshold — Hukuki Güvenlik Sözleşmesi (Step 16).
    When the Zero-Trust citation engine reports grounding_ratio below this
    value, the LLM answer is discarded and replaced with a safe refusal text.
    A ratio of 0.5 means ≥50 % of answer sentences must carry a [K:N] citation.
    Set 0.0 to disable the post-LLM hard-fail (not recommended in production)."""

    audit_ragas_target_source_count: int = 3
    """Target minimum number of sources for full context_recall score.
    context_recall = min(1.0, source_count / audit_ragas_target_source_count).
    Default 3 matches the Tier 1 top-3 retrieval window.
    Increase to 5 or 10 for Tier 2/3 workloads with denser context."""

    # ── Quality Gate thresholds (CI/CD) ───────────────────────────────────────
    quality_gate_min_faithfulness: float = 0.70
    """Minimum acceptable average faithfulness score across canonical test suite.
    Faithfulness = grounded_sentences / total_sentences.
    Below threshold → deployment BLOCKED."""

    quality_gate_min_answer_relevancy: float = 0.50
    """Minimum average query–answer keyword overlap score.
    Below threshold → deployment BLOCKED."""

    quality_gate_min_context_precision: float = 0.55
    """Minimum average source final_score (context precision).
    Below threshold → deployment BLOCKED."""

    quality_gate_min_context_recall: float = 0.65
    """Minimum average source coverage (context recall).
    Set lower than 1.0 to account for single-source edge-case test cases.
    Below threshold → deployment BLOCKED."""

    quality_gate_min_overall_quality: float = 0.65
    """Minimum average weighted composite RAGAS score.
    Formula: 0.35*faith + 0.25*relev + 0.25*prec + 0.15*recall.
    Below threshold → deployment BLOCKED."""

    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment.lower() == "production"
    
    @property
    def is_development(self) -> bool:
        """Check if running in development environment."""
        return self.environment.lower() == "development"


# Global settings instance
settings = Settings()
