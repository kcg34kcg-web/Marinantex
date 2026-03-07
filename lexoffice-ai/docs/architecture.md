# LexOffice AI Architecture

## Ürün Tanımı

LexOffice AI, hukuk ofisleri için çok kiracılı SaaS çalışma platformudur: tenant operasyonu, çok sağlayıcılı kurumsal e-posta yönetimi, matter/client/task ilişkisi ve AI destekli yardımcı iş akışlarını tek panelde birleştirir.

## Sistem Mimarisi

### Katmanlar

- **Web/App Layer (`apps/web`)**: Next.js 15 App Router, server components + client components, tenant route space.
- **API Layer (`apps/web/app/api/v1`)**: Route handlers, Zod contract validation, session + tenant authorization.
- **Domain Layer (`packages/core`)**: Auth, tenant, RBAC, domain onboarding, mail sync/thread, AI action servisleri.
- **Integrations Layer (`packages/mail`)**: Gmail / Microsoft 365 / Yandex / IMAP adapter registry, provider bağımsız interface.
- **Data Layer (`packages/db`)**: Prisma schema + migrations + seed + typed client.
- **Jobs/Events Layer (`apps/worker`)**: BullMQ worker, sync job execution, retry/failure handling.
- **Contracts Layer (`packages/contracts`)**: API request/response Zod şemaları ve paylaşılan tipler.

### Neden Bu Stack

- **Next.js 15 + App Router**: Tek repo içinde hem UI hem API üretimi, edge ve server bileşen dengesinde hızlı geliştirme.
- **Prisma + PostgreSQL**: Güçlü ilişki modeli, migration yönetimi, kurumsal sorgu ve indeks optimizasyonu.
- **Redis + BullMQ**: Mail sync ve AI işlemlerinde idempotent arka plan işlerini güvenli yönetme.
- **Provider Adapter Pattern**: Gmail label/folder model farklarını tek domain katmanında soyutlayarak vendor lock-in azaltma.
- **pnpm + Turborepo**: Monorepo cache, bağımlılık kontrolü ve CI hız optimizasyonu.

## Monorepo Yapısı

```txt
lexoffice-ai/
  apps/
    web/                      # Next.js UI + API
    worker/                   # BullMQ workers
  packages/
    core/                     # Domain services
    db/                       # Prisma schema, seed, db client
    mail/                     # Provider adapters
    contracts/                # Zod API contracts
    ui/                       # Shared UI kit
    config/                   # Shared lint/config
  docs/                       # Architecture, IA, OpenAPI, checklists
```

## Domain Model Özeti

- **Tenant sınırı**: Tenant her veri modelinde birincil izolasyon anahtarıdır (`tenantId`).
- **Kimlik/Yetki**: `User`, `Membership`, `Role`, `Permission`, `RolePermission`, `UserSession`.
- **Mail Core**: `Mailbox`, `MailboxConnection`, `MailboxSyncState`, `MailThread`, `MailMessage`, `Draft`, `Signature`.
- **Domain/Mail readiness**: `Domain`, `DomainDnsRecord`, `DomainVerification`.
- **Matter/CRM**: `Client`, `Matter`, `Contact`, `Task`, `Deadline`, `Document`, `MatterMessage`.
- **AI İzlenebilirlik**: `AIConversation`, `AIMessage`, `UsageRecord`, `AuditLog`, `SecurityEvent`.

## Mail Provider Abstraction

### Interface

`MailProviderAdapter` sözleşmesi:

- `connect()`
- `refreshToken()`
- `listMailboxes()`
- `listFoldersOrLabels()`
- `syncMessages()`
- `getMessage()`
- `getThread()`
- `sendMessage()`
- `createDraft()`
- `updateDraft()`
- `deleteMessage()`
- `archiveMessage()`
- `markRead()`
- `moveMessage()`
- `addLabel()`
- `removeLabel()`
- `watch()`
- `stopWatch()`
- `getProfile()`
- `buildAuthorizationUrl()`
- `parseWebhookEvent()`

### Sağlayıcılar

- `GmailProviderAdapter`
- `MicrosoftGraphMailAdapter`
- `YandexMailAdapter`
- `ImapSmtpAdapter`

### Sync Stratejisi

- Event destekli yerlerde webhook/watch, desteklenmeyen yerlerde polling fallback.
- Incremental cursor (`syncCursor`, `historyId`, `deltaToken`) saklama.
- Background job idempotency, retry, failure state, audit kaydı.

### OAuth + Webhook Akışı

- `GET /api/v1/integrations/mail/oauth/start` provider authorize URL üretir.
- `GET /api/v1/integrations/mail/oauth/callback` mailbox bağlantısını finalize eder ve initial sync kuyruğa alır.
- `POST /api/v1/webhooks/mail/{provider}` eventleri normalize eder, tenant mailbox eşleşmesine göre incremental sync tetikler.

## Tenant / RBAC Özeti

- Tenant erişimi route seviyesinde session tenant eşleşmesi ile zorlanır.
- RBAC kontrolü endpoint seviyesinde `requirePermission` ile uygulanır.
- System roller: `super_admin`, `tenant_owner`, `partner`, `lawyer`, `trainee_lawyer`, `secretary`, `office_manager`, `read_only_auditor`.
- Kritik işlemler `AuditLog` + `SecurityEvent` tablosuna iz bırakır.

## İlk Sprint Planı (10 İş Günü)

1. **Temel Platform**: monorepo config, env, docker-compose, Prisma çekirdek şema.
2. **Auth/Tenant/RBAC**: login/logout/me, tenant create, member invite, role-permission seed.
3. **Domain Onboarding**: domain wizard API, DNS template, verify akışı, status lifecycle.
4. **Mailbox Connect + Inbox v1**: provider adapter registry, mailbox connect, thread list/detail.
5. **Sync ve Worker**: sync trigger, BullMQ worker, incremental sync state + audit.
6. **AI Mail Actions v1**: summary/reply/task extraction suggestions, feedback metrikleri.
7. **Hardening**: request-id/security headers, immutable audit hash, baseline e2e smoke.
