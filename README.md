# Babylexit - Comprehensive Legal SaaS Platform

## 🏗️ Project Structure

This is a full-stack legal technology platform with:

- **Frontend**: Next.js 15 (App Router) - Turkish legal case management UI
- **Backend**: FastAPI (Python) - Privacy-first AI orchestration engine

```
Marinantex/
├── app/                    # Next.js frontend (App Router)
├── components/            # React components
├── lib/                   # Client utilities
├── supabase/             # Database schema & migrations
├── backend/              # 🆕 Python FastAPI backend (v3.0)
│   ├── api/              # REST endpoints & middleware
│   ├── application/      # Use cases & services
│   ├── domain/           # Business logic
│   └── infrastructure/   # DB, cache, agents, privacy
├── docker-compose.yml    # 🆕 Redis + API orchestration
└── ...
```

---

## 🚀 Quick Start

### Frontend (Next.js)

```bash
# Install dependencies
npm install

# Run development server
npm run dev
# Open http://localhost:3000
# Mail workspace: http://localhost:3001 (auto-starts with dev)

# Quality checks
npm run check
npm run format:check
```

### Engineering Standards (Step 1)

- TypeScript strict mode is enabled.
- Path alias standard: `@/*`.
- Linting: `eslint . --max-warnings=0`.
- Formatting: Prettier (`.prettierrc.json`).
- Commit message convention: Conventional Commits (`feat:`, `fix:`, `chore:` ...).
- Git hooks:
  - `pre-commit`: runs `lint-staged`
  - `commit-msg`: validates commit message with Commitlint

### Environment & Provider Setup (Step 2)

- Local environment template: copy [.env.local.example](.env.local.example) to `.env.local`.
- Production environment template: copy [.env.production.example](.env.production.example) to deployment secrets.
- Supabase server key uses `SUPABASE_SERVICE_ROLE_KEY` (legacy `SUPABASE_SERVICE_KEY` is still accepted as fallback).
- AI provider priority for legal generation:
  1.  Google (`GOOGLE_GENERATIVE_AI_API_KEY`)
  2.  Cohere (`COHERE_API_KEY`)
  3.  OpenAI (`OPENAI_API_KEY`)

### Source Search Live Adapter

- `/api/search` can run in two backend modes:
  - `SEARCH_BACKEND_MODE=live` (default, RAG v3 backed live retrieval)
  - `SEARCH_BACKEND_MODE=mock` (only when `SEARCH_ALLOW_MOCK=true`)
- Production guardrail: when runtime is production, mock mode is fail-closed (`PRODUCTION_REQUIRES_LIVE_SEARCH`).
- Production guardrail: live backend URL must be explicitly configured (`SEARCH_LIVE_RAG_BACKEND_URL` or `SEARCH_LIVE_RAG_BACKEND_URLS`), localhost fallback is disabled.
- Live adapter env knobs:
  - `SEARCH_LIVE_RAG_BACKEND_URL` / `SEARCH_LIVE_RAG_BACKEND_URLS`
  - `SEARCH_LIVE_TIMEOUT_MS`
  - `SEARCH_LIVE_RAG_TIER`, `SEARCH_LIVE_JURISDICTION`, `SEARCH_LIVE_ACL_TAGS`
  - optional `SEARCH_LIVE_BUREAU_ID`, `SEARCH_LIVE_USER_ID`, `SEARCH_LIVE_ACCESS_LEVEL`, `SEARCH_LIVE_BEARER_TOKEN`
- Live smoke command (expects web app on `:3000`): `npm run smoke:search:live`
- Evidence gap report command: `npm run report:evidence:gaps`
- Metadata quality backfill command: `npm run backfill:rag:metadata-quality`
- Coverage evidence seed command (ictihat + model-lane traces): `npm run seed:rag:evidence`

### Litigation Intelligence Hardening (Step 3)

- Ortak graf veri sözleşmesi: [lib/litigation/graph.ts](lib/litigation/graph.ts)
- API yanıtı Zod ile doğrulanır: [app/api/litigation/cases/[id]/graph/route.ts](app/api/litigation/cases/[id]/graph/route.ts)
- İstemci tarafında payload doğrulaması aktif: [components/dashboard/cosmograph-live-graph.tsx](components/dashboard/cosmograph-live-graph.tsx)
- Tüm graf tarihleri `DD.MM.YYYY` formatında gösterilir.

### Cosmograph Worker Performance (Step 4)

- Worker yerleşim motoruna performans telemetrisi eklendi: iterasyon, süre, düğüm/kenar sayısı.
- Büyük grafiklerde adaptif iterasyon ve zaman bütçesi (`frameBudgetMs`) uygulanır.
- Yerleşim sonucunda sayısal güvenlik kontrolleri (NaN/Infinity) ile koordinatlar stabilize edilir.
- Canlı metrik görünümü: [components/dashboard/cosmograph-live-graph.tsx](components/dashboard/cosmograph-live-graph.tsx)

### Graph Neighborhood Query (Step 5)

- Düğüm odaklı lazy fetch endpoint eklendi: [app/api/litigation/cases/[id]/graph/neighborhood/route.ts](app/api/litigation/cases/[id]/graph/neighborhood/route.ts)
- Komşuluk veri sözleşmesi Zod ile tanımlandı: [lib/litigation/graph.ts](lib/litigation/graph.ts)
- Dashboard paneline düğüm kimliği ile komşuluk sorgu kutusu eklendi: [components/dashboard/cosmograph-live-graph.tsx](components/dashboard/cosmograph-live-graph.tsx)

### Contradiction Cost Control (Step 6)

- Graf endpoint’ine sunucu tarafı filtre parametreleri eklendi: `minSimilarity`, `maxEdges`.
- Aday kenarlar benzerlik skoruna göre filtrelenir ve en yüksek skorlu kenarlar önceliklenir.
- İstemci panelinde maliyet kontrol UI’si eklendi (`Aday Filtreleme`): [components/dashboard/cosmograph-live-graph.tsx](components/dashboard/cosmograph-live-graph.tsx)
- Aday daraltma metrikleri gösterilir (`totalCandidates → returnedLinks`).

### Worker Transfer Optimization (Step 7)

- Worker sonuçları artık `ids + Float32Array` koordinat buffer olarak gönderilir.
- `ArrayBuffer` transferi ile büyük grafikte ana thread kopyalama maliyeti azaltılır.
- İstemci tarafında buffer decode edilerek `layoutNodes` map’i yeniden kurulur: [components/dashboard/cosmograph-live-graph.tsx](components/dashboard/cosmograph-live-graph.tsx)

### Evidence Bundle Manifest (Step 8)

- Bundle manifest endpoint’i eklendi: [app/api/litigation/cases/[id]/bundle-export/route.ts](app/api/litigation/cases/[id]/bundle-export/route.ts)
- SHA-256 bundle hash + Merkle root + zincir hash (`evidence_chain_logs`) birlikte üretilir.
- `bundle_exports` tablosuna final bundle hash yazılır.
- Panelde `Bundle Manifest` aksiyonu ile özet hash/metrikler gösterilir: [components/dashboard/cosmograph-live-graph.tsx](components/dashboard/cosmograph-live-graph.tsx)

### Jurisdictional Diff (Step 9)

- Kural seti listeleme endpoint’i eklendi: [app/api/litigation/jurisdictions/route.ts](app/api/litigation/jurisdictions/route.ts)
- Kural seti karşılaştırma endpoint’i eklendi: [app/api/litigation/jurisdictions/diff/route.ts](app/api/litigation/jurisdictions/diff/route.ts)
- Karşılaştırma şemaları ve diff yardımcıları: [lib/litigation/jurisdiction.ts](lib/litigation/jurisdiction.ts)
- Intelligence paneline yargı kural seti karşılaştırma kartı eklendi: [components/dashboard/litigation-intelligence-panel.tsx](components/dashboard/litigation-intelligence-panel.tsx)

### Desktop Agent Ingest Contract (Step 10)

- Planlanan ingest endpoint’i aktif edildi: [app/api/litigation/ingest/route.ts](app/api/litigation/ingest/route.ts)
- Şifreli zarf doğrulaması ve cevap şemaları eklendi: [lib/litigation/ingest.ts](lib/litigation/ingest.ts)
- İçe aktarılan payload için SHA-256 hesaplanır, `evidence_chain_logs` tablosuna `ocr` aşaması olarak chain kaydı yazılır.
- Panelde `Desktop Ingest Pilot` butonu ile sözleşme doğrulama akışı test edilir: [components/dashboard/litigation-intelligence-panel.tsx](components/dashboard/litigation-intelligence-panel.tsx)

### Ingest Replay Protection (Step 11)

- İçe aktarma akışına replay koruması eklendi: aynı `senderDeviceId + sequence` tekrarında istek reddedilir.
- Monoton sequence kuralı aktif: aynı cihaz için yeni sequence değeri önceki değerden büyük olmalıdır.
- Replay/sequence metaverisi `evidence_chain_logs` içinde `ocr_sequence` aşaması ile izlenir.
- Uygulama: [app/api/litigation/ingest/route.ts](app/api/litigation/ingest/route.ts)

### Ingest Window & Nonce Guardrails (Step 12)

- `sentAt` için zaman penceresi doğrulaması eklendi (çok eski / ileri tarihli istekler reddedilir).
- Zarf boyutu için üst limit eklendi (`413` koruması).
- Nonce replay koruması eklendi: aynı cihaz + nonce tekrarında istek reddedilir.
- Nonce izleme kayıtları `evidence_chain_logs` içinde `ocr_nonce` aşaması ile tutulur.

### Chain Continuity Audit (Step 13)

- Chain süreklilik denetimi endpoint’i eklendi: [app/api/litigation/cases/[id]/chain/audit/route.ts](app/api/litigation/cases/[id]/chain/audit/route.ts)
- `previous_hash` bağlantı kopuklukları ve eksik hash durumları raporlanır.
- Audit şeması: [lib/litigation/chain-audit.ts](lib/litigation/chain-audit.ts)
- Intelligence panelde `Chain Audit` aksiyonu ile özet süreklilik sonucu gösterilir: [components/dashboard/litigation-intelligence-panel.tsx](components/dashboard/litigation-intelligence-panel.tsx)

### Litigation Utility Tests (Step 14)

- Chain audit mantığı yeniden kullanılabilir yardımcıya ayrıldı: [lib/litigation/chain-audit.ts](lib/litigation/chain-audit.ts)
- Utility testleri eklendi: [tests/litigation-core.test.ts](tests/litigation-core.test.ts)
  - Merkle/root ve chain hash deterministikliği
  - Jurisdiction diff ve karşılaştırılan alan sayısı
  - Chain süreklilik kopukluğu tespiti

### Release Quality Gate (Step 15)

- Litigation odaklı kalite kapısı script’i eklendi: `npm run quality:litigation`
- Script sırası:
  1.  `npm run check` (lint + typecheck)
  2.  `npm run test:litigation` (kritik litigation utility testleri)
- Hızlı tekil test komutu: `npm run test:litigation`

### Backend (FastAPI) - NEW in v3.0

```bash
# Navigate to backend
cd backend

# Create virtual environment
python -m venv venv
venv\Scripts\Activate.ps1  # Windows
# source venv/bin/activate  # Linux/Mac

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start Redis
cd ..
docker-compose up -d redis

# Start API
cd backend
python start.py
# API available at http://localhost:8000
```

**See [backend/SETUP.md](backend/SETUP.md) for detailed instructions.**

---

## 📖 Documentation

| Document                                                 | Description                     |
| -------------------------------------------------------- | ------------------------------- |
| [backend/README.md](backend/README.md)                   | Backend architecture overview   |
| [backend/SETUP.md](backend/SETUP.md)                     | Step-by-step installation guide |
| [backend/ARCHITECTURE.md](backend/ARCHITECTURE.md)       | System design & data flow       |
| [backend/PHASE1_COMPLETE.md](backend/PHASE1_COMPLETE.md) | Implementation status report    |

---

## 🎯 Features

### Frontend (Production)

✅ **Authentication**: Supabase Auth (password + magic link)  
✅ **Dashboard**: Lawyer case management with React Query  
✅ **Portal**: Client case view with 2FA (OTP)  
✅ **Office Tools**: LexSphere integration (documents, HMK, notifications)  
✅ **AI Chat**: Streaming chat with RAG and provider fallback  
✅ **Finance**: TBK/SMM/İİK calculators with immutable ledger  
✅ **Intelligence**: Litigation graph visualization (Cosmograph)

### Backend (v3.0 - PHASE 1 Complete)

✅ **Clean Architecture**: Domain-driven design with layers  
✅ **Privacy-First**: PII masking middleware (regex-based)  
✅ **LangGraph**: Checkpointer for agent state persistence  
✅ **Redis**: Cache layer for performance  
✅ **Supabase**: Single source of truth for data  
✅ **Docker**: Containerized deployment

### Upcoming (PHASE 2-4)

⏳ **Presidio**: Advanced Turkish PII detection  
⏳ **Semantic Router**: Cost-efficient query routing  
⏳ **Time Machine**: Temporal legal document queries  
⏳ **Agent Workflows**: Planner/Researcher/Writer orchestration  
⏳ **Citation Engine**: Traceable legal claims

---

## 🛠️ Tech Stack

### Frontend

- **Framework**: Next.js 15 (App Router, React 19)
- **Styling**: TailwindCSS + shadcn/ui
- **State**: TanStack Query (React Query)
- **Database**: Supabase (Postgres + RLS)
- **Auth**: Supabase Auth (SSR)

### Backend (NEW)

- **API**: FastAPI (async Python)
- **Orchestration**: LangChain + LangGraph
- **Database**: Supabase (Postgres) + pgvector
- **Cache**: Redis (Docker)
- **Privacy**: Presidio (PHASE 2)
- **Embeddings**: HuggingFace (local)
- **LLMs**: OpenAI, Anthropic, Groq (fallback chain)

---

## 🔐 Security

### Frontend

- Row-Level Security (RLS) policies in Supabase
- Middleware-based role enforcement
- Portal 2FA with OTP (cookie-based)

### Backend

- **Layer 1**: PII masking (all outbound data anonymized)
- **Layer 2**: RLS policies (Supabase)
- **Layer 3**: Rate limiting (60/min per user)
- **Layer 4**: Audit trail (checkpointed workflows)

---

## 📊 Development Status

| Component                | Status                  |
| ------------------------ | ----------------------- |
| Next.js Frontend         | ✅ Production           |
| Supabase Schema          | ✅ Production           |
| Auth Flows               | ✅ Production           |
| Dashboard/Portal         | ✅ Production           |
| Office Tools             | ✅ Production           |
| AI Chat (basic)          | ✅ Production           |
| **Backend API**          | ✅ **PHASE 1 Complete** |
| Privacy Layer (advanced) | ⏳ PHASE 2              |
| Semantic Router          | ⏳ PHASE 2              |
| Time Machine             | ⏳ PHASE 3              |
| Agent Workflows          | ⏳ PHASE 4              |

---

## 🐳 Docker Deployment

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

**Services:**

- `redis`: Cache & pub/sub (port 6379)
- `api`: FastAPI backend (port 8000)

---

## 🧪 Testing

### Frontend

```bash
npm test
npm run build  # Production build check
```

### Backend

```bash
cd backend
pytest  # (PHASE 4 - tests not implemented yet)
```

---

## 📦 Environment Variables

### Frontend (.env.local)

```env
NEXT_PUBLIC_APP_ENV=local
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
COHERE_API_KEY=
OPENAI_API_KEY=
```

### Backend (backend/.env)

```env
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
DATABASE_URL=
REDIS_URL=
PII_ENCRYPTION_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GROQ_API_KEY=
```

---

## 🤝 Architecture Philosophy

### Frontend: User Experience

- Server-side rendering for fast page loads
- Client-side React Query for data freshness
- Optimistic UI updates
- Streaming responses for AI chat

### Backend: Privacy & Compliance

- **Zero Trust**: All data is potentially sensitive
- **Fail Secure**: Block requests if privacy layer fails
- **Auditability**: Every agent decision is logged
- **Cost Efficiency**: Route intelligently to minimize API calls

---

## 📈 Roadmap

### Q1 2026 (Current)

- [x] PHASE 1: Infrastructure & Secure State ✅
- [ ] PHASE 2: Privacy Layer (Presidio + Turkish NER)
- [ ] PHASE 2: Semantic Router (cost optimization)

### Q2 2026

- [ ] PHASE 3: Knowledge Graph & Time Machine
- [ ] PHASE 3: Living Documents (Resmi Gazete integration)

### Q3 2026

- [ ] PHASE 4: Agentic Workflows (LangGraph full implementation)
- [ ] PHASE 4: Citation Engine
- [ ] Production deployment

---

## 🐛 Known Issues

See [backend/PHASE1_COMPLETE.md](backend/PHASE1_COMPLETE.md) for current limitations.

---

## 📄 License

Private - All Rights Reserved

---

## 📞 Support

For issues or questions:

1. Check [backend/SETUP.md](backend/SETUP.md)
2. Review logs: `docker-compose logs -f api`
3. Contact development team

---

**Last Updated**: February 19, 2026  
**Version**: Frontend v1.0 + Backend v3.0 (PHASE 1)
