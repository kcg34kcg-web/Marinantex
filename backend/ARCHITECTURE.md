# Babylexit v3.0 - System Architecture

## High-Level Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         NEXT.JS FRONTEND                          │
│                    (Port 3000 - Existing App)                     │
│                                                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Dashboard  │  │   AI Chat    │  │  Legal Calculators     │  │
│  │  (Lawyer)   │  │  (Semantic)  │  │  (TBK, SMM, İİK)      │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │   Portal    │  │  LexSphere   │  │  Litigation Intel      │  │
│  │  (Client)   │  │  (Office)    │  │  (Graph Analysis)      │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            │ HTTP/SSE
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                    FASTAPI BACKEND (NEW)                          │
│                        Port 8000                                   │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              PRIVACY-FIRST GATEWAY (Layer 1)               │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │  │
│  │  │ PII Detect   │→│   Masking    │→│ Re-identification│  │  │
│  │  │ (Presidio)   │  │ (Reversible) │  │   (Restore)     │  │  │
│  │  └──────────────┘  └──────────────┘  └─────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                            │                                       │
│                            ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │            SEMANTIC ROUTER (Layer 2)                       │  │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐ │  │
│  │  │ Simple   │  │ Legal    │  │ Complex   │  │ Admin    │ │  │
│  │  │ ($0)     │  │ Search   │  │ Agentic   │  │ Panel    │ │  │
│  │  └──────────┘  └──────────┘  └───────────┘  └──────────┘ │  │
│  └────────────────────────────────────────────────────────────┘  │
│                            │                                       │
│                            ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              LANGGRAPH ORCHESTRATION                       │  │
│  │                                                             │  │
│  │    ┌──────────┐     ┌─────────────┐     ┌──────────┐     │  │
│  │    │ PLANNER  │────▶│ RESEARCHER  │────▶│  WRITER  │     │  │
│  │    │          │     │             │     │          │     │  │
│  │    │ - Analyze│     │ - RAG Query │     │ - Generate│     │  │
│  │    │ - Route  │     │ - Vector    │     │ - Cite    │     │  │
│  │    │ - Budget │     │ - Time      │     │ - Format  │     │  │
│  │    │          │     │   Travel    │     │           │     │  │
│  │    └──────────┘     └─────────────┘     └──────────┘     │  │
│  │         │                  │                   │           │  │
│  │         └──────────────────┼───────────────────┘           │  │
│  │                            ▼                                │  │
│  │                   ┌─────────────────┐                      │  │
│  │                   │  CHECKPOINTER   │◀─────────┐           │  │
│  │                   │  (Postgres)     │          │           │  │
│  │                   └─────────────────┘          │           │  │
│  │                   Persistent State  ───────────┘           │  │
│  └────────────────────────────────────────────────────────────┘  │
└───────────────────────┬───────────────┬──────────────────────────┘
                        │               │
        ┌───────────────┘               └──────────────┐
        ▼                                               ▼
┌──────────────────┐                          ┌─────────────────┐
│   SUPABASE       │                          │     REDIS       │
│   (Postgres)     │                          │     (Cache)     │
│                  │                          │                 │
│ - Cases          │                          │ - Embeddings    │
│ - Documents      │                          │ - API Cache     │
│ - Legal DB       │                          │ - Pub/Sub       │
│ - RLS Policies   │                          │   (SSE)         │
│ - pgvector       │                          └─────────────────┘
│ - Checkpoints    │
└──────────────────┘

        │
        ▼
┌──────────────────┐
│   LLM PROVIDERS  │
│                  │
│ - OpenAI         │
│ - Anthropic      │
│ - Groq (Fallback)│
└──────────────────┘
```

---

## Data Flow: Query Processing

```
1. User Query
   "2019'da iş sözleşmesi feshi için tazminat nasıl hesaplanırdı?"
   │
   ▼
2. PRIVACY GATEWAY
   - Detects: No PII
   - Action: Pass through
   │
   ▼
3. SEMANTIC ROUTER
   - Embedding: [0.234, -0.567, ...]
   - Classification: "complex_legal_temporal"
   - Route: Agent Workflow
   │
   ▼
4. LANGGRAPH PLANNER
   - Checkpoint #1: Initial state
   - Decision: "Need time-travel RAG + calculation"
   - Sub-tasks: [Query legal DB @ 2019, Calculate TBK amounts]
   │
   ▼
5. RESEARCHER AGENT
   - Checkpoint #2: Research start
   - Query: pgvector with time filter (valid_from <= 2019 <= valid_to)
   - Results: [İş Kanunu Madde 17 (2003-2020 version)]
   - Checkpoint #3: Research complete
   │
   ▼
6. WRITER AGENT
   - Checkpoint #4: Writing start
   - Generate: Response with citations
   - Cite: [İş Kanunu Md. 17, Yargıtay 9. HD 2018/1234]
   - Checkpoint #5: Complete
   │
   ▼
7. PRIVACY UNMASK
   - No masked data to restore
   │
   ▼
8. RESPONSE (SSE Stream)
   "2019 yılında, İş Kanunu Madde 17'ye göre..."
```

---

## Security Layers

```
┌─────────────────────────────────────────┐
│  Layer 1: PII Masking                   │
│  - TC ID: [MASKED_TC_ID_a3b2c1d4]      │
│  - Phone: [MASKED_PHONE_e5f6g7h8]      │
└─────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  Layer 2: Row-Level Security (RLS)      │
│  - Supabase policies enforce access     │
│  - Lawyers see own cases only           │
└─────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  Layer 3: Rate Limiting                 │
│  - 60 requests/minute per user          │
│  - Burst: 10 requests                   │
└─────────────────────────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  Layer 4: Audit Trail                   │
│  - Every checkpoint saved to Postgres   │
│  - Full workflow replay capability      │
└─────────────────────────────────────────┘
```

---

## PHASE 1 Components (✅ Completed)

| Component                  | Status | Description                          |
|----------------------------|--------|--------------------------------------|
| FastAPI Setup              | ✅     | Async server with lifespan events    |
| Postgres Pool              | ✅     | asyncpg for LangGraph checkpointer   |
| Supabase Client            | ✅     | Knowledge base connection            |
| Redis Client               | ✅     | Cache & pub/sub wrapper              |
| AsyncPostgresCheckpointer  | ✅     | Custom LangGraph state storage       |
| Privacy Middleware         | ✅     | Regex-based PII detection (basic)    |
| Docker Compose             | ✅     | Redis + API orchestration            |
| Configuration Management   | ✅     | Pydantic settings with validation    |

---

## PHASE 2-4 Roadmap

### PHASE 2: Privacy Layer (2 weeks)
- Integrate Microsoft Presidio
- Turkish NER model training
- Re-identification pipeline
- Privacy audit logging

### PHASE 3: Time Machine (3 weeks)
- Temporal schema design (valid_from/valid_to)
- Legal document versioning
- Point-in-time queries
- Living document updates (Resmi Gazete scraper)

### PHASE 4: Agentic Workflows (4 weeks)
- LangGraph agent implementation
- Streaming SSE responses
- Citation engine (statute → DB link)
- Multi-turn conversation memory
- Cost tracking & budgeting

---

## Technology Choices

| Requirement               | Technology            | Rationale                           |
|---------------------------|-----------------------|-------------------------------------|
| Privacy (PII Detection)   | Presidio              | GDPR/KVKK compliant, Turkish NER    |
| Orchestration             | LangGraph             | Checkpointing, state management     |
| Embeddings                | HuggingFace (local)   | Zero cost, Turkish multilingual     |
| Vector DB                 | pgvector (Supabase)   | Single source of truth              |
| Cache                     | Redis                 | Fast, ephemeral, pub/sub            |
| State Persistence         | Postgres              | Durable, queryable, audit trail     |
| LLMs                      | OpenAI/Anthropic/Groq | Fallback chain for reliability      |

---

## Monitoring & Observability

```
FastAPI
  ├─ Prometheus Metrics (/metrics)
  │   - Request count
  │   - Latency (p50, p95, p99)
  │   - Error rate
  │   - LLM token usage
  │
  ├─ Structured Logs (stdout → CloudWatch/ELK)
  │   - Privacy events
  │   - Agent decisions
  │   - Citations generated
  │
  └─ Health Checks
      - Postgres pool
      - Redis connection
      - Supabase availability
```

---

## Performance Targets

| Metric                    | Target      | Strategy                             |
|---------------------------|-------------|--------------------------------------|
| API Response Time (p95)   | < 200ms     | Redis caching, connection pooling    |
| Agent Workflow (simple)   | < 5s        | Semantic routing (avoid LLM if possible) |
| Agent Workflow (complex)  | < 30s       | Streaming SSE (progressive response) |
| Concurrent Users          | 1000+       | Async FastAPI, horizontal scaling    |
| Database Queries          | < 50ms      | Indexes, pgvector IVFFlat            |
| PII Masking Overhead      | < 10ms      | Compiled regex, Presidio cache       |

---

## Cost Optimization

```
Query Path Decision Tree:

User Query
  │
  ├─ "Merhaba" → Canned Response (Cost: $0)
  │
  ├─ "Abonelik iptali" → Template + DB Lookup (Cost: $0)
  │
  ├─ "İş Kanunu 17 nedir?" → RAG Only (Cost: $0.01)
  │
  └─ "5 yıllık kıdem tazminatı analizi" → Full Agent (Cost: $0.05)
     
Monthly Budget per User: $10
Estimated Queries: 500/month
Average Cost per Query: $0.02
```

This architecture ensures:
1. **Privacy-First**: No PII reaches LLMs
2. **Cost-Efficient**: Semantic routing eliminates unnecessary API calls
3. **Auditable**: Every decision is checkpointed
4. **Scalable**: Stateless API, distributed cache
5. **Reliable**: Fallback chain for LLM providers
