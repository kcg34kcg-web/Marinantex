# API Contracts

Tüm endpointlerde giriş/çıkış doğrulaması `@lexoffice/contracts` içindeki Zod şemaları ile yapılır.

## Auth

### `POST /api/v1/auth/login`

- Auth: Public
- Request: `email`, `password`, `tenantSlug`
- Response: `sessionId`, `expiresAt`, `user`, `tenant`, `role`
- Errors: `401`, `400`

### `GET /api/v1/auth/me`

- Auth: Session zorunlu
- Response: aktif session + tenant membership özeti
- Errors: `401`

### `POST /api/v1/auth/logout`

- Auth: Session varsa revoke edilir
- Response: `{ success: true }`
- Errors: `500`

## Tenant / Membership

### `POST /api/v1/tenants`

- Auth: Session zorunlu
- Permission: Tenant create akışı (onboarding owner)
- Request: `name`, `slug`, `locale`, `timezone`
- Response: tenant profile
- Errors: `401`, `409`, `400`

### `POST /api/v1/members/invite`

- Auth: Session zorunlu
- Permission: `user.invite`
- Request: `tenantId`, `email`, `firstName`, `lastName`, `roleCode`
- Response: membership invitation kaydı
- Errors: `401`, `403`, `404`, `400`

## Domains

### `GET /api/v1/domains?tenantId=...`

- Auth: Session zorunlu
- Permission: `domain.manage`
- Response: domain listesi + dns records + mailbox summary

### `POST /api/v1/domains`

- Auth: Session zorunlu
- Permission: `domain.manage`
- Request: `tenantId`, `domainName`, `provider`, `mode`
- Response: oluşturulan domain + dns records

### `GET /api/v1/domains/{domainId}?tenantId=...`

- Auth: Session zorunlu
- Permission: `domain.manage`
- Response: domain detail + verification geçmişi

### `POST /api/v1/domains/{domainId}/verify`

- Auth: Session zorunlu
- Permission: `domain.manage`
- Request: `tenantId`
- Response: DNS doğrulama sonucu + güncel status

## Mailbox / Mail

### `GET /api/v1/mailboxes?tenantId=...`

- Auth: Session zorunlu
- Permission: `mailbox.view`
- Response: mailbox list + sync/connect state

### `POST /api/v1/mailboxes`

- Auth: Session zorunlu
- Permission: `mailbox.connect`
- Request: provider + token set + mailbox profile
- Response: bağlı mailbox kaydı

### `POST /api/v1/mailboxes/provision`

- Auth: Session zorunlu
- Permission: `mailbox.create` + `domain.manage`
- Request: `tenantId`, `domainId`, `localPart`, `displayName?`, `provider?`, `aliasLocalParts[]`
- Response: provision edilen mailbox + adapter sonucu
- Not: İlk sürümde provisioning adapter’ları mock modda çalışır; sözleşme production canlı adapter’a hazırdır.

### `GET /api/v1/mail/threads?tenantId=...`

- Auth: Session zorunlu
- Permission: `mailbox.view`
- Request query: `mailboxId`, `query`, `limit`, `cursor`
- Response: paginated thread list + `nextCursor`

### `GET /api/v1/mail/threads/{threadId}?tenantId=...`

- Auth: Session zorunlu
- Permission: `mailbox.view`
- Response: thread detail + messages + recipients + attachments

### `POST /api/v1/mail/messages/{messageId}/read`

- Auth: Session zorunlu
- Permission: `mailbox.view`
- Request: `tenantId`, `read`
- Response: `{ success: true }`

### `POST /api/v1/drafts`

- Auth: Session zorunlu
- Permission: `mail.draft.save`
- Request: draft autosave payload
- Response: draft record

### `POST /api/v1/mail/send`

- Auth: Session zorunlu
- Permission: `mail.send`
- Request: sender mailbox + recipients + body + attachments
- Response: `messageId`, `threadId`, `providerMessageId`

### `POST /api/v1/mail/send/schedule`

- Auth: Session zorunlu
- Permission: `mail.send`
- Request: `mail.send` payload + `scheduledAt` (ISO datetime), `undoWindowSeconds?`
- Response: `scheduledDraftId`, `scheduledAt`, `correlationId`

### `POST /api/v1/mail/send/scheduled/{scheduledDraftId}/cancel`

- Auth: Session zorunlu
- Permission: `mail.send`
- Request: `tenantId`
- Response: `{ scheduledDraftId, canceled: true }`

### `POST /api/v1/mail/sync/trigger`

- Auth: Session zorunlu
- Permission: `mailbox.view`
- Request: `tenantId`, `mailboxId`, `mode`
- Response: queued sync payload + `correlationId`

### `POST /api/v1/mail/threads/{threadId}/matter`

- Auth: Session zorunlu
- Permission: `client.matter.access`
- Request: `tenantId`, `matterId`, `note?`
- Response: link confirmation

## Integrations / Webhooks

### `GET /api/v1/integrations/mail/oauth/start`

- Auth: Session zorunlu
- Permission: `mailbox.connect`
- Query: `tenantId`, `provider`, `emailHint?`
- Response: `{ authorizationUrl, provider, redirectUri }`

### `GET /api/v1/integrations/mail/oauth/callback`

- Auth: Session cookie ile callback doğrulaması
- Query: `code`, `state`, `error?`
- Response: JSON yerine tenant settings sayfasına redirect

### `POST /api/v1/webhooks/mail/{provider}`

- Auth: Provider webhook signature doğrulaması
- Payload: provider event body (raw)
- Response: `{ received, eventCount, queuedSyncJobs }`
- Not: eşleşen provider account için incremental sync kuyruğa alınır

## CRM / Matter / Task

### `GET /api/v1/clients?tenantId=...`

- Auth: Session zorunlu
- Permission: `client.matter.access`
- Query: `query?`, `limit?`
- Response: client listesi

### `POST /api/v1/clients`

- Auth: Session zorunlu
- Permission: `client.matter.access`
- Request: `tenantId`, `name`, `email?`, `code?`, `status?`
- Response: oluşturulan client

### `GET /api/v1/matters?tenantId=...`

- Auth: Session zorunlu
- Permission: `client.matter.access`
- Query: `clientId?`, `status?`, `limit?`
- Response: matter listesi + client özeti

### `POST /api/v1/matters`

- Auth: Session zorunlu
- Permission: `client.matter.access`
- Request: `tenantId`, `clientId`, `title`, `referenceNo?`
- Response: oluşturulan matter

### `GET /api/v1/tasks?tenantId=...`

- Auth: Session zorunlu
- Permission: `client.matter.access`
- Query: `matterId?`, `status?`, `assignedToId?`, `limit?`
- Response: task listesi

### `POST /api/v1/tasks`

- Auth: Session zorunlu
- Permission: `client.matter.access`
- Request: `tenantId`, `title`, `matterId?`, `priority?`, `dueAt?`
- Response: oluşturulan task

### `POST /api/v1/tasks/{taskId}/status`

- Auth: Session zorunlu
- Permission: `client.matter.access`
- Request: `tenantId`, `status`
- Response: güncellenen task

## AI

### `POST /api/v1/ai/mail-actions`

- Auth: Session zorunlu
- Permission: `ai.workspace`
- Request: `tenantId`, `threadId`, `action`, `preferredLanguage`, `messageId?`, `stream?`
- Response: suggestion + structured output + usage metering + `humanApprovalRequired`

### `POST /api/v1/ai/mail-actions/stream`

- Auth: Session zorunlu
- Permission: `ai.workspace` + `mail.ai.compose`
- Request: `tenantId`, `threadId`, `action`, `preferredLanguage`, `messageId?`, `stream=true`
- Response: `text/event-stream`
- Events:
- `meta`: `aiMessageId`, `structuredOutput`, `usage`, `humanApprovalRequired`
- `chunk`: `content`
- `done`: `{ completed: true }`
- `error`: stream error payload

### `POST /api/v1/ai/feedback`

- Auth: Session zorunlu
- Permission: `ai.workspace`
- Request: `tenantId`, `aiMessageId`, `accepted`
- Response: `{ success: true }`

### `GET /api/v1/ai/stats?tenantId=...`

- Auth: Session zorunlu
- Permission: `ai.workspace`
- Response: tenant AI suggestion istatistikleri (totals, acceptance rate, token usage, action kırılımı)

## Settings

### `POST /api/v1/settings/tenant`

- Auth: Session zorunlu
- Permission: tenant owner / admin scope
- Request: `tenantId`, profile fields
- Response: updated tenant profile

## Standart Hata Kodları

- `400 VALIDATION_ERROR`
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 CONFLICT`
- `500 INTERNAL_ERROR`

Detaylı OpenAPI: `docs/openapi.yaml`
