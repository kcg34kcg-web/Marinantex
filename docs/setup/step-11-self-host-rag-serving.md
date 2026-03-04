# Step 11 - Self-Host RAG Serving (vLLM + TEI)

Bu dokuman SaaS production benzeri self-host kurulum icin tek compose akisini tanimlar.

## 1) Ortam degiskenlerini hazirla

Asgari gerekli degiskenler:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `DATABASE_URL`
- `PII_ENCRYPTION_KEY`
- `JWT_SECRET_KEY`

Model servisleri icin:

- `VLLM_MODEL` (ornek: `Qwen/Qwen2.5-7B-Instruct`)
- `VLLM_SERVED_MODEL` (ornek: `qwen2.5-7b-instruct`)
- `EMBEDDING_MODEL_ID` (ornek: `BAAI/bge-m3`)
- `EMBEDDING_DIMENSIONS` (bge-m3 icin `1024`)
- `EMBEDDING_API_KEY` (TEI icin statik token)

## 2) Stack'i ayaga kaldir

```bash
docker compose -f docker-compose.rag-serving.yml up -d --build
```

Servisler:

- `vllm` (OpenAI-compatible LLM endpoint)
- `tei-embed` (OpenAI-compatible embeddings endpoint)
- `backend-rag` (FastAPI RAG)
- `redis`

## 3) Health kontrol

```bash
curl -fsS http://localhost:8008/v1/models
curl -fsS http://localhost:8081/health
curl -fsS http://localhost:8000/health
```

Beklenen:

- vLLM model listesi doner.
- TEI `health` endpoint `200` doner.
- Backend `status=healthy|degraded` doner.

## 4) Backend self-host ayarlari (compose tarafinda set edilir)

- `OPENAI_BASE_URL=http://vllm:8000/v1`
- `OPENAI_API_KEY=local-openai-compatible`
- `EMBEDDING_BASE_URL=http://tei-embed:8080/v1`
- `EMBEDDING_MODEL=BAAI/bge-m3`
- `EMBEDDING_DIMENSIONS=1024`
- `EMBEDDING_SEND_DIMENSIONS_PARAM=false`

Not:

- Bu akista prod LLM/embedding dis saglayiciya bagli degildir.
- `AI_TIER_*` provider/model map'leri compose icinde `openai + VLLM_SERVED_MODEL` olarak set edilir.
