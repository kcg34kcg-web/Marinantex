# Babylexit v3.0 - Setup Guide

## PHASE 1: Infrastructure & Secure State ✅

### Project Structure Created

```
backend/
├── api/
│   ├── main.py                    # FastAPI entry point
│   ├── middleware/
│   │   └── privacy_gateway.py     # PII masking middleware
│   ├── routes/                    # REST endpoints (TODO: PHASE 2-4)
│   └── schemas/                   # Pydantic models
├── application/                   # Use cases (TODO: PHASE 2-4)
├── domain/                        # Business logic (TODO: PHASE 2-4)
├── infrastructure/
│   ├── config.py                  # Settings management
│   ├── database/
│   │   └── connection.py          # Supabase + Postgres pool
│   ├── cache/
│   │   └── redis_client.py        # Redis wrapper
│   ├── agents/
│   │   └── checkpoint.py          # LangGraph checkpointer
│   └── privacy/                   # Presidio integration (TODO: PHASE 2)
├── Dockerfile                     # Container definition
├── requirements.txt               # Python dependencies
├── .env.example                   # Environment template
└── README.md                      # Architecture documentation
```

---

## Installation Steps

### 1. Environment Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# Activate (Linux/Mac)
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configure Environment Variables

```bash
# Copy template
cp .env.example .env

# Edit .env with your credentials
notepad .env  # Windows
nano .env     # Linux/Mac
```

**Required Variables:**
```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_key
DATABASE_URL=postgresql://postgres:password@host:5432/postgres

# Redis
REDIS_URL=redis://localhost:6379

# LLM (at least one)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...

# Privacy
PII_ENCRYPTION_KEY=<run: python -c "import secrets; print(secrets.token_hex(32))">
```

### 3. Start Redis (Docker)

```bash
# From project root
docker-compose up -d redis

# Verify Redis is running
docker ps
redis-cli ping  # Should return PONG
```

### 4. Run FastAPI Development Server

```bash
# From backend/ directory
uvicorn api.main:app --reload --port 8000
```

**Expected Output:**
```
🚀 Babylexit v3.0 - 'Sovereign' Legal Engine Starting...
✅ Postgres connection pool initialized
✅ Redis client connected
✅ Supabase client initialized
✅ LangGraph checkpointer initialized
🎯 All systems operational. Privacy-first gateway active.
```

### 5. Test API

```bash
# Health check
curl http://localhost:8000/health

# Root endpoint
curl http://localhost:8000

# API docs (Swagger UI)
open http://localhost:8000/docs
```

---

## Database Setup

### Create Checkpointer Table

The checkpointer table is created automatically on startup, but you can verify:

```sql
-- Run in Supabase SQL Editor
SELECT * FROM langgraph_checkpoints LIMIT 1;
```

---

## Docker Deployment (Optional)

### Build and Run

```bash
# Build image
docker build -t babylexit-api ./backend

# Run with docker-compose (includes Redis)
docker-compose up -d

# View logs
docker-compose logs -f api
```

---

## Next Steps (PHASE 2)

### Privacy Layer Enhancement
- [ ] Integrate Microsoft Presidio for advanced PII detection
- [ ] Add support for Turkish NER models
- [ ] Implement re-identification pipeline for responses
- [ ] Add Redis-based mask store (distributed)

### Semantic Router
- [ ] Build local embedding-based router (HuggingFace)
- [ ] Define route categories (simple, legal, complex)
- [ ] Implement cost-tracking per route

### Agent Workflows (PHASE 4)
- [ ] Create Planner/Researcher/Writer agents with LangGraph
- [ ] Implement streaming SSE for real-time updates
- [ ] Add citation engine (link every claim to statute/precedent)

---

## Troubleshooting

### Issue: "Redis connection refused"
**Solution:** Start Redis with `docker-compose up -d redis`

### Issue: "asyncpg.exceptions.InvalidCatalogNameError"
**Solution:** Verify DATABASE_URL points to correct Postgres instance

### Issue: "ModuleNotFoundError: No module named 'infrastructure'"
**Solution:** Run from backend/ directory or add to PYTHONPATH:
```bash
export PYTHONPATH="${PYTHONPATH}:/path/to/backend"
```

### Issue: "PII masking fails"
**Solution:** For PHASE 1, privacy middleware uses regex. Errors are logged but don't block requests. Check logs for details.

---

## Architecture Decisions

### Why Postgres for Checkpoints (not Redis)?
- **Audit Trail**: Legal compliance requires permanent state history
- **Reliability**: Redis is ephemeral; Postgres is durable
- **Queryability**: Can analyze agent behavior with SQL

### Why Separate API and Frontend?
- **Security**: Backend never exposes Supabase service key
- **Scalability**: Can scale API independently of Next.js SSR
- **Privacy**: PII masking happens in Python (mature NLP tools)

### Why LangGraph (not plain LangChain)?
- **State Management**: Built-in checkpointing
- **Workflow Visualization**: Can graph agent decision trees
- **Human-in-the-Loop**: Can pause workflows for lawyer approval

---

## Current Limitations (PHASE 1)

1. **Privacy Middleware**: Basic regex only (no Presidio yet)
2. **No Routes**: Chat/Search endpoints not implemented
3. **No Agents**: LangGraph workflows not built
4. **No Time Travel**: Temporal queries not implemented

These will be addressed in PHASE 2-4.

---

## Support

For issues or questions:
1. Check logs: `docker-compose logs -f api`
2. Verify environment: `cat .env`
3. Test Redis: `redis-cli ping`
4. Test Postgres: `psql $DATABASE_URL -c "SELECT 1"`
