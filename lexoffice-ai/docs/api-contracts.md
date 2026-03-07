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

## AI

### `POST /api/v1/ai/mail-actions`

- Auth: Session zorunlu
- Permission: `ai.workspace`
- Request: `tenantId`, `threadId`, `action`, `preferredLanguage`, `messageId?`
- Response: suggestion + usage metering + `humanApprovalRequired`

### `POST /api/v1/ai/feedback`

- Auth: Session zorunlu
- Permission: `ai.workspace`
- Request: `tenantId`, `aiMessageId`, `accepted`
- Response: `{ success: true }`

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
