# Step 1 - Local Development

## 1) Install dependencies

```bash
npm install
```

## 2) Prepare environment

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

## 3) Start infrastructure

```bash
npm run docker:up
```

## 4) Start web + api

```bash
npm run dev
```

## 5) Validate health

```bash
curl http://localhost:3000/api/health
curl http://localhost:4000/health
```

## 6) RAG dataset ingest

RAG veri yukleme akisi icin:
- `docs/setup/step-2-rag-v3-dataset-upload.md`
