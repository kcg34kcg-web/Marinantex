# Babylexit v3.0 - "Sovereign" Legal Engine Backend

## Architecture: Clean Architecture (Modular Monolith)

```
backend/
├── domain/                    # Core Business Logic (Framework-Agnostic)
│   ├── entities/             # Domain Models (Legal Case, Statute, Citation)
│   ├── repositories/         # Abstract Interfaces (No Implementation)
│   └── value_objects/        # Immutable Objects (DateRange, CaseStatus)
│
├── application/              # Use Cases & Orchestration
│   ├── use_cases/           # Business Operations (AnalyzeLegalQuery)
│   └── services/            # Domain Services (TimeTravel, CitationEngine)
│
├── infrastructure/           # External Integrations (Frameworks & Drivers)
│   ├── database/            # Postgres (AsyncPg), Supabase Client
│   ├── cache/               # Redis Client & Pub/Sub
│   ├── agents/              # LangGraph Workflows (Planner, Researcher)
│   ├── privacy/             # PII Masking (Presidio), Re-identification
│   └── llm/                 # LLM Providers (OpenAI, Anthropic, Groq)
│
└── api/                      # FastAPI Entry Point
    ├── routes/              # REST Endpoints (Chat, Search, Admin)
    ├── middleware/          # Privacy Gateway, CORS, Auth
    └── schemas/             # Pydantic Request/Response Models

```

## Core Principles

### 1. Privacy-First (Zero Trust)
- **PII Masking**: User data is anonymized before reaching LLMs via Presidio.
- **Re-identification**: Masked entities are restored in the final response.
- **Middleware Enforcement**: All outbound requests pass through privacy layer.

### 2. Cost-Efficient Intelligence
- **Semantic Retrieval**: `text-embedding-3-small` is the default embedding model (configurable via env).
- **Tiered Routing**: "Merhaba" → $0 | "İş sözleşmesi feshi" → Agent workflow.

### 3. Temporal Legal Knowledge (Time Machine)
- **Versioned Statutes**: Every legal article has `valid_from` and `valid_to` dates.
- **Point-in-Time Queries**: Users can ask "2015'te bu kanun ne diyordu?".
- **Living Documents**: Outdated analyses are flagged when Resmi Gazete updates arrive.

### 4. Auditability & Trust
- **Citation Engine**: Every legal claim links to a database record (statute/precedent).
- **Checkpoint History**: LangGraph state is persisted in Postgres (full audit trail).
- **No Hallucination**: Responses must cite retrievable sources.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API Framework | FastAPI (async) |
| Orchestration | LangChain + LangGraph |
| Database | Supabase (Postgres) + pgvector |
| Cache | Redis (Docker) |
| Privacy | Presidio + Regex Rules |
| Embeddings | OpenAI `text-embedding-3-small` (default, configurable) |
| Reranker | `BAAI/bge-reranker-v2-m3` (RAG v3) |
| LLMs | OpenAI, Anthropic, Groq (fallback) |

## Development

```bash
# Start Redis
docker-compose up -d

# Install dependencies
pip install -r requirements.txt

# Run FastAPI server
uvicorn api.main:app --reload --port 8000
```

## Self-Host Serving (SaaS Prod Path)

Use the repository-level compose for local production-like bring-up:

```bash
docker compose -f docker-compose.rag-serving.yml up -d --build
```

This stack includes:

- vLLM (OpenAI-compatible LLM endpoint)
- TEI (OpenAI-compatible embeddings endpoint for `bge-m3`)
- FastAPI backend wired to those local endpoints

Runbook: `docs/setup/step-11-self-host-rag-serving.md`

## Environment Variables

```env
# Database (Supabase)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key

# LLM Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...

# Redis
REDIS_URL=redis://localhost:6379

# Privacy
PII_ENCRYPTION_KEY=your_32_byte_key
```

## Phase Roadmap

- [x] **PHASE 1**: Infrastructure & Secure State
- [ ] **PHASE 2**: Privacy Layer (Presidio Integration)
- [ ] **PHASE 3**: Knowledge Graph & Time Travel
- [ ] **PHASE 4**: Agentic Workflow & Streaming UX
