# Step 11 (Mac) - RAG Serving (Apple Silicon Uyumlu)

Bu akis `vllm + TEI` yerine Mac'te sorunsuz calisan bir yol sunar:

- `backend-rag` (Docker)
- `redis` (Docker)
- LLM endpoint: disaridaki OpenAI-compatible servis (`OPENAI_BASE_URL`)
- Embedding endpoint: disaridaki OpenAI-compatible servis (`EMBEDDING_BASE_URL`)

Not: `ghcr.io/huggingface/text-embeddings-inference:1.8` image'i bu ortamda `linux/arm64` manifest vermedigi icin kullanilmiyor.

## 1) Docker credential PATH (bir kere)

```bash
echo 'export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
which docker-credential-desktop
```

## 2) Ortam degiskenleri

Asgari degiskenler:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `DATABASE_URL`
- `PII_ENCRYPTION_KEY`
- `JWT_SECRET_KEY`

Model endpointleri:

- `OPENAI_BASE_URL` (ornek: `https://api.openai.com/v1` veya `http://host.docker.internal:1234/v1`)
- `OPENAI_API_KEY`
- `EMBEDDING_BASE_URL` (ornek: `https://api.openai.com/v1`)
- `EMBEDDING_API_KEY` (bos birakilirsa uygulama `OPENAI_API_KEY` kullanir)
- `EMBEDDING_MODEL` (ornek: `text-embedding-3-small`)
- `EMBEDDING_DIMENSIONS` (ornek: `1536`)

Qwen tier map (istege bagli override):

- `AI_TIER_DUSUNCELI_MODEL` (varsayilan: `Qwen/Qwen3-Next-80B-A3B-Instruct`)
- `AI_TIER_UZMAN_MODEL` (varsayilan: `Qwen/Qwen3-Next-80B-A3B-Thinking`)

## 3) Stack'i kaldir

```bash
docker compose -f docker-compose.rag-serving.mac.yml up -d --build
```

## 4) Health kontrol

```bash
curl -fsS http://localhost:8000/health
```

Opsiyonel endpoint kontrolu:

```bash
curl -fsS "$OPENAI_BASE_URL/models"
curl -fsS "$EMBEDDING_BASE_URL/models" || true
```

## 5) Kisa RAG smoke

```bash
curl -sS http://localhost:8000/api/v1/rag-v3/query \
  -H 'Content-Type: application/json' \
  -H 'X-Bureau-ID: 061bab08-4230-4b1f-878e-c50b95d3fc6c' \
  -d '{
    "query":"Kidem tazminati hangi sartlarda dogar?",
    "requested_tier":2,
    "jurisdiction":"TR",
    "top_k":8,
    "legal_disclaimer_ack":true,
    "human_responsibility_ack":true
  }'
```

## 6) Kapatma

```bash
docker compose -f docker-compose.rag-serving.mac.yml down
```
