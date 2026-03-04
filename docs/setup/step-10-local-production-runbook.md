# Step 10 - Local Production-Like Runbook

Bu runbook, sistemi production benzeri local ortamda (containerized) ayağa kaldırmak için hazırlanmıştır.

## 1) Ortam dosyalarını hazırla

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

Minimum kritik değişkenler:

- `JWT_SECRET`
- `CORS_ORIGINS`
- `NEXT_PUBLIC_API_BASE_URL`

## 2) Containerları build + up

```bash
npm run docker:prod-local:up
```

Bu komut aşağıdaki servisleri çalıştırır:

- `postgres`
- `redis`
- `minio`
- `api` (NestJS)
- `web` (Next.js)

## 3) Health kontrolü

```bash
curl http://localhost:4000/health
curl http://localhost:3000/api/health
```

## 4) Smoke test çalıştır

```bash
npm run smoke:test
```

Smoke test şunları doğrular:

- API/Web health endpointleri
- Web güvenlik headerları
- Tenant header zorunluluğu
- Auth yoksa erişim engeli
- Geçersiz public share token davranışı

## 5) Log izleme

```bash
npm run docker:prod-local:logs
```

## 6) Kapatma

```bash
npm run docker:prod-local:down
```

## Notlar

- PDF export için container içinde Playwright Chromium kullanılır.
- Export queue Redis üzerinde çalışır.
- MinIO bucket başlangıçta `minio-init` ile otomatik oluşturulur.
