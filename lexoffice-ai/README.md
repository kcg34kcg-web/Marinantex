# LexOffice AI

LexOffice AI, hukuk ofisleri için çok kiracılı SaaS mimaride geliştirilen birleşik çalışma platformudur: tenant yönetimi, çok sağlayıcılı kurumsal mail, domain onboarding, AI yardımcı aksiyonlar ve operasyon paneli tek üründe birleşir.

## Durum

Bu repo artık Aşama 1-10’un çalışan omurgasını içerir:

- Auth + Tenant + RBAC + Audit
- Domain onboarding + DNS template + verify akışı
- Mailbox connect + unified inbox + thread detail + compose/draft autosave + gönderim
- Unified inbox keyboard navigation + infinite thread loading + optimistic read/unread
- Queue tabanlı mail sync trigger + worker işleme
- AI mail action panel + suggestion feedback + thread-to-matter linking
- Tenant settings güncelleme API + UI
- Unit test altyapısı + Playwright smoke + CI workflow
- Docker compose (dev/prod) + web/worker Dockerfile

## Mimaride Seçimler

- **Frontend + API:** Next.js 15 App Router
- **Domain servisleri:** `packages/core`
- **Veri:** Prisma + PostgreSQL
- **Queue:** Redis + BullMQ
- **Mail entegrasyonu:** Provider adapter registry (Gmail/Microsoft/Yandex/IMAP)
- **AI:** provider-agnostic service (ilk sürüm mock engine + audit + usage)

Detay: `docs/architecture.md`, `docs/frontend-ia.md`, `docs/api-contracts.md`

## Monorepo

```txt
lexoffice-ai/
  apps/
    web/            # Next.js app + API routes
    worker/         # BullMQ consumers
  packages/
    contracts/      # Zod schema + API contract
    core/           # Domain services
    db/             # Prisma schema + seed + client
    mail/           # Provider adapters
    ui/             # Shared UI primitives
    config/         # Shared config
  docs/
    openapi.yaml
    security-threat-model.md
    checklists/
```

## Hızlı Başlangıç

```bash
cd lexoffice-ai
corepack pnpm install
cp .env.example .env
corepack pnpm --filter @lexoffice/db prisma:generate
corepack pnpm --filter @lexoffice/db prisma:migrate -- --name init
corepack pnpm db:seed
corepack pnpm dev
```

Web: `http://localhost:3000`
Mailpit: `http://localhost:8025`
MinIO Console: `http://localhost:9001`

## Demo Giriş

- Email: `owner@demo.lexoffice.ai`
- Password: `ChangeMe123!`
- Tenant slug: `demo-hukuk`

## Önemli Route'lar

- `/sign-in`
- `/{tenantSlug}/dashboard`
- `/{tenantSlug}/settings/domains`
- `/{tenantSlug}/mail`
- `/{tenantSlug}/mail/{threadId}`
- `/{tenantSlug}/mail/compose`
- `/{tenantSlug}/ai`
- `/{tenantSlug}/admin/audit`

## API Örnekleri

- `POST /api/v1/domains`
- `POST /api/v1/domains/{domainId}/verify`
- `POST /api/v1/mailboxes`
- `GET /api/v1/integrations/mail/oauth/start`
- `GET /api/v1/integrations/mail/oauth/callback`
- `GET /api/v1/mail/threads`
- `POST /api/v1/mail/sync/trigger`
- `POST /api/v1/drafts`
- `POST /api/v1/mail/send`
- `POST /api/v1/ai/mail-actions`
- `POST /api/v1/ai/feedback`
- `POST /api/v1/webhooks/mail/{provider}`

Detaylar: `docs/openapi.yaml`

## Test ve Kalite

```bash
corepack pnpm -r typecheck
corepack pnpm -r test
corepack pnpm e2e:smoke
```

`e2e:smoke` komutu izole bir PostgreSQL konteyneri (`lexoffice-postgres-e2e`, port `55432`) başlatır, Prisma şemasını uygular, seed verisini yükler ve ardından Playwright smoke senaryolarını çalıştırır.

## Deploy

- Geliştirme: `docker-compose.yml`
- Üretim örneği: `docker-compose.prod.yml`
- Container build: `apps/web/Dockerfile`, `apps/worker/Dockerfile`
- CI: `.github/workflows/ci.yml`

## Security Notları

- Session token hash saklama
- Tenant-aware authorization
- RBAC check enforced endpointlerde
- Audit event logging + immutable hash chain
- Login success/failure security events
- Request-id propagation + security headers middleware
- OAuth start/callback + provider webhook ingest akışı
- Threat model ve checklists: `docs/security-threat-model.md`, `docs/checklists/*`

## TODO (Bilinçli Placeholder)

- Gerçek OAuth callback + token encryption (KMS envelope)
- Gmail/Graph/Yandex gerçek API mapping + webhook signature doğrulama
- Attachment scanning ve signed URL gateway
- AI gerçek provider çağrısı + model fallback + streaming
- Reply/reply-all/forward pipeline ve schedule send tamamlama
