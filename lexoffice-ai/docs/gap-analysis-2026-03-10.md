# LexOffice AI Gap Analysis (2026-03-10)

Bu analiz, hedef gereksinim listesini mevcut kod tabanıyla karşılaştırır.

## 1) Durum Özeti

- **Tamamlanan Omurga**
  - Multi-tenant temel model, auth, RBAC, audit, domain onboarding, mailbox connect, unified inbox, AI action panel, worker tabanlı sync, CI/CD ve Docker iskeleti.
- **Yeni Eklenenler (bu revizyon)**
  - Provider token encryption-at-rest + runtime refresh akışı.
  - Managed provisioning adapter registry + provisioning service + endpoint.
  - CRM API çekirdeği (`/clients`, `/matters`, `/tasks`) + temel create/list UI formları.
- **Hala Kritik Boşlukta Olanlar**
  - Gerçek provider API entegrasyonları (Gmail/Graph/Yandex) ve production webhook doğrulamaları.
  - ABAC/policy layer, MFA akışları, attachment signed URL + malware scanning pipeline.
  - Kapsamlı endpoint seti ve advanced mail operasyonları (reply-all, forward, schedule send, spam/trash/archive move).

## 2) Gereksinim Karşılama Matrisi

### A) Tenant / Ofis Yönetimi
- **Durum:** Kısmi
- **Var:** tenant, settings, membership, plan, audit, feature flags veri modelleri.
- **Eksik:** tenant bazlı billing lifecycle, gelişmiş security policy UI, immutable audit external sink.

### B) Kullanıcı / Rol / Yetki
- **Durum:** Kısmi
- **Var:** system roles, permission catalog, RBAC enforcement on kritik route’lar.
- **Eksik:** ABAC koşul motoru, delegated policy rule editor, role simulation/debug ekranı.

### C) Domain Onboarding + Özel Mailbox
- **Durum:** Kısmi
- **Var:** domain wizard, DNS template, verify akışı, durum yönetimi.
- **Eksik:** registrar API otomasyonu, DNS auto-check schedule ekranı, domain suspension lifecycle automation.

### D) Çok Sağlayıcılı Mail
- **Durum:** Kısmi
- **Var:** provider abstraction, OAuth start/callback, sync queue, unified inbox, thread detail, send, draft autosave.
- **Eksik (kritik):**
  - Provider adapter’lar halen stub/mock.
  - Reply-all/forward/schedule-send pipeline yok.
  - Spam/trash/archive/move/label bulk action API’ları eksik.
  - WebSocket/SSE live mail update (sync notification channel) yok.

### E) Hukuk Asistanı
- **Durum:** Kısmi
- **Var:** AI action panel, structured output, stream, feedback, usage ve audit.
- **Eksik:** gerçek LLM provider routing/fallback, safety policy engine derinliği, human review workflow UI.

### F) Client / Matter / Task Entegrasyonu
- **Durum:** Kısmi (iyileştirildi)
- **Var:** veri modeli, thread-to-matter link, yeni create/list API ve UI formları.
- **Eksik:** contacts/deadlines/documents CRUD API tamamı, task assignment workflow ve timeline.

### G) Yönetim Paneli
- **Durum:** Kısmi
- **Var:** tenant settings, audit ekranı, domain/mail yönetim ekranları.
- **Eksik:** queue monitor, provider health dashboard, billing hooks, security events panel.

### H) Güvenlik / Uyum
- **Durum:** Kısmi (iyileştirildi)
- **Var:** token hash session, encrypted provider token storage, security headers, RBAC, audit hash chain.
- **Eksik (kritik):**
  - MFA enrollment/challenge flow.
  - CSRF double-submit/session binding kontrolü.
  - Attachment signed URL gateway + MIME hard validation + AV scan.
  - Key rotation orchestration ve multi-key decrypt window.

### I) Test Kapsamı
- **Durum:** Kısmi
- **Var:** unit + e2e smoke/critical flows.
- **Eksik:** gerçek provider contract tests, security abuse tests, load/perf tests, disaster recovery drill tests.

## 3) P0 / P1 / P2 Önceliklendirme

## P0 (Release blocker)
- Gmail/Graph/Yandex gerçek adapter implementasyonu.
- Attachment security chain (signed URL + scan + access control).
- MFA + session/device management endpointleri.
- Rate limit + abuse prevention hardening (`auth`, `ai`, `webhook`, `send`).

## P1 (Go-live hardening)
- Queue DLQ dashboard + retry observability.
- Token/key rotation runbook + re-encryption tool.
- Mail advanced actions ve retention policy job’ları.
- Security events panel + alert hooks.

## P2 (Scale & product depth)
- ABAC/policy engine.
- OpenSearch abstraction ve gelişmiş search syntax.
- Provider provisioning live adapter’ları.
- AI policy simulator ve reviewer queue.

## 4) Önerilen Sonraki Sprintler

1. **Sprint A (Security + Mail Real Providers):** real adapters, token refresh monitoring, attachment gateway.
2. **Sprint B (Operations + Admin):** queue/health dashboards, security events UI, retention jobs.
3. **Sprint C (Legal Workflow Depth):** deadlines/documents APIs, assignment workflow, AI reviewer mode.
