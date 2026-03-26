# Testing Strategy

## Amaç

LexOffice AI için test stratejisi, çok kiracılı izolasyon, mail akışları, AI aksiyonları ve RBAC güvenliğini release öncesi otomatik olarak doğrulamayı hedefler.

## Katmanlar

- Unit (`vitest`): domain servisleri, provider adapter mapping, sync davranışı, AI servis mantığı
- API contract (`zod` + route tests): request/response doğrulama ve hata kodu garantisi
- Integration (service + db): draft autosave, send, thread-to-matter, audit kayıtları
- E2E (`playwright`): kullanıcı akışları (auth, inbox, compose, AI, RBAC)

## Otomatik Kapsam

- `packages/core`
- Domain DNS template/verify
- RBAC permission resolution
- Mail thread service (draft/send/link)
- AI service (structured output + stats + stream chunking)

- `packages/mail`
- Provider registry + stub provider davranışları

- `apps/web/tests/e2e/smoke.spec.ts`
- Sign-in ekranı
- Tenant dashboard erişimi
- Domain management ekran render

- `apps/web/tests/e2e/critical-flows.spec.ts`
- Unified inbox ve thread detail
- Compose autosave + send
- Thread-to-matter linking
- AI action + feedback + audit görünürlüğü
- RBAC negatif (AI yetkisi olmayan rol)

## Çalıştırma

```bash
corepack pnpm -r typecheck
corepack pnpm -r test
corepack pnpm e2e:smoke
```

Not: `e2e:smoke` komutu Docker daemon gerektirir ve izole PostgreSQL konteyneri ayağa kaldırır.

## CI Gate'leri

- Lint
- Typecheck
- Unit tests
- Build
- Playwright smoke/critical e2e

## TODO (Planlı E2E Genişleme)

- OAuth callback happy-path (Gmail / Microsoft / Yandex) için containerized Redis + webhook mock ile tam akış
- Provider webhook ingest + incremental sync observable assertion
- Attachment upload + malware scan hook entegrasyon testi
- Plan-limit ve feature flag negatif senaryoları
