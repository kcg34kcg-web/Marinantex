# Client Portal V2 Enterprise Architecture (Existing-System Integrated)

## 1) Executive Scope
- Objective: build a secure multi-tenant client portal (`müvekkil paneli`) on top of the already-running legal office platform.
- Strategy: additive rollout, no destructive schema changes, backward-compatible API extensions, feature-flag-based progressive activation per tenant.
- Tenancy model: existing `bureaus` is the canonical tenant root; `tenant_id` is standardized across new/extended entities.

## 2) Non-Breaking Integration Strategy
1. Keep existing office workflows (`/dashboard`, case operations, RAG) unchanged.
2. Add new portal capabilities behind tenant flags in `portal_feature_flags`.
3. Reuse existing canonical entities:
- `profiles` as base users.
- `bureaus` as tenants.
- `cases`, `case_clients`, `case_documents`, `case_timeline_events` as legal source-of-truth.
4. Add bridge logic for legacy paths:
- Legacy `cases.client_id` still supported.
- New preferred client visibility: `case_clients` many-to-many.
5. Avoid duplication:
- No tenant clone tables for cases/documents.
- Use additive columns (`tenant_id`) and additive portal tables (sessions, consent, AI ledger, immutable audit).
6. Phased deployment:
- P0: secure read-only case list/detail/timeline/docs + messaging write.
- P1: consent/versioning, evidence-grade audit exports, session/device management.
- P2: advanced AI summaries, self-hosted model option, calendar sync, billing controls.

## 3) System Architecture

### Chosen topology
- **Modular monolith for core product** (Next.js API routes + Supabase/Postgres) with clear service boundaries.
- **Async worker layer** for heavy jobs (AI processing, OCR, file pipeline, notifications).
- **Gateway pattern** at edge (Next middleware + API routes) for auth, routing, tenant resolution.

### Logical services
1. Auth Service
- JWT + refresh tokens.
- 2FA (OTP now; authenticator/SMS in P1 hardening).
- Device/session lifecycle (`sessions` table).
2. Case Service
- Case list/detail/timeline and case-level authorization checks.
3. Document Service
- Secure metadata, version history, signed URLs, malware scan state, OCR status.
4. Messaging Service
- Case-based immutable threads (`portal_case_messages` + read receipts).
5. AI Service
- Summarization + legal simplification with policy guardrails.
6. Notification Service
- Real-time stream (WebSocket/SSE) + email/push fanout.
7. Audit/Compliance Service
- Append-only `audit_logs` with hash-chain.
- Consent/version and retention orchestration.

### Runtime integration
- Existing FastAPI RAG backend remains intact.
- Portal API routes in Next.js call Supabase with strict server-side authorization.
- Queue workers consume jobs for AI, email, OCR, export.

## 4) Multi-Tenant Isolation Model
1. Tenant identity
- Canonical: `bureaus.id`.
- Canonical routing: `{tenant-subdomain}.app.com` or org context in JWT claims.
2. Data isolation
- All new entities include `tenant_id`.
- Existing entities progressively standardized with additive `tenant_id` backfill (no breaking rename from `bureau_id`).
3. Enforcement layers
- DB-level RLS as primary enforcement.
- API layer case/client ownership checks to prevent IDOR.
- Service-to-service headers (`X-Bureau-ID`) only from trusted backend.
4. Cross-tenant leakage prevention
- Tenant-scoped unique constraints and indexes.
- Explicit policy checks compare row `tenant_id` with current profile tenant.
- Security tests include cross-tenant negative test suite.

## 5) Authorization Model (RBAC + Object ACL)

### Roles
- Lawyer/Admin: full office controls.
- Client: read-only case/doc timeline and messaging write only for own case threads.

### Permission matrix (logical)

| Resource | Lawyer/Admin | Client |
|---|---|---|
| Cases | read/write/export/delete | read own only |
| Case timeline | read/write | read own public items |
| Documents | read/write/version/export | read/download own (signed URL) |
| Messages | read/write | read/write own case threads |
| AI summary | generate/view | view requested summary |
| Consent | view/manage tenant templates | grant/withdraw own |
| Sessions | manage all tenant sessions | manage own sessions |
| Audit logs | read/export tenant | read own event scope (limited) |

### Data-level rules
1. Client access requires both:
- `tenant_id` match.
- Case linkage (`case_clients.client_id` or legacy fallback).
2. Message write requires:
- sender = `auth.uid()`
- case belongs to same tenant
- client linked to case
3. Document read requires:
- case linkage + tenant match + signed URL TTL.

## 6) Security Architecture (Defense in Depth)

### Mandatory controls
1. Row-Level Security
- Enabled on portal-sensitive tables (`sessions`, `consents`, `ai_requests`, `portal_case_messages`, `audit_logs`, RBAC tables).
2. IDOR prevention
- Server-side case ACL checks for every case-scoped endpoint.
3. Broken access control prevention
- No direct object fetch by ID without tenant+ownership check.
4. Injection prevention
- Strict Zod validation, parameterized queries, output escaping.
5. Signed URL document delivery
- Short-lived signed links, one-time token optional, download audit event.
6. Encryption
- TLS in transit.
- At-rest encryption via managed DB/storage.
- Optional E2EE envelope for highly sensitive message payloads.

### Additional controls
- Rate limit per IP and per user.
- Brute-force protection for login/OTP.
- CAPTCHA escalation after repeated failures.
- WAF-compatible headers and endpoint patterns.
- Device fingerprinting and suspicious-login alerts.

## 7) Audit & Legal Evidence Logging

### Event coverage
- login/logout/failed login
- case view
- document access/download
- message sent/read
- AI summary request/result/failure
- permission changes
- consent grant/withdraw
- session revoke

### Evidence-grade design
1. `audit_logs` append-only.
2. Hash-chain fields: `previous_hash`, `event_hash`.
3. Mutation blocked by triggers (`update/delete` forbidden).
4. Export format:
- JSONL + CSV + signed manifest with checksum.
5. Retention policy configurable by tenant with legal hold override.

## 8) GDPR + KVKK Compliance Architecture
1. Explicit consent flow
- versioned consent records in `consents`.
2. Consent versioning
- unique `(tenant_id, user_id, consent_type, consent_version)`.
3. Right to be forgotten
- queued deletion workflow with legal-hold guard.
- soft-delete then cryptographic erasure for eligible data.
4. Data portability
- user export bundle (profile, case-visible docs/messages, consent history, AI usage logs).
5. Retention
- policy engine + deletion batch audit trail.
6. AI disclaimer
- mandatory: “This summary is for informational purposes only.”

## 9) AI Architecture (Safe + Controlled)

### Supported modes
- External LLM provider (OpenAI-like).
- Private/self-hosted model lane for restricted tenants.

### Safety pipeline
1. Input sanitation:
- file type validation, OCR text sanitization, control-token stripping.
2. Prompt injection defense:
- isolate system prompt.
- classify and block suspicious instructions.
- deny tool escalation from user content.
3. Output policy filtering:
- no legal-advice certainty claims.
- no definitive outcome prediction.
4. Storage policy:
- hashed prompt in `ai_requests`.
- optional no-retention mode per tenant.
5. Observability:
- confidence score.
- policy flags.
- “Report incorrect summary” feedback capture.

## 10) Performance & Scalability
1. Cache strategy (Redis)
- Tenant-scoped cache keys (`tenant:{id}:...`).
- case list, document metadata, permission matrix, feature flags.
- short TTL + explicit invalidation on writes.
2. Queue strategy
- BullMQ (Node) or Celery (Python) for:
  - AI summaries
  - email/push notifications
  - OCR and file parsing
  - antivirus scan pipeline
  - evidence export packaging
3. Horizontal scaling
- stateless API nodes
- sticky optional for WebSocket session fanout
- DB connection pooling

## 11) File Processing Pipeline
1. Large upload support (>100MB)
- multipart/chunked uploads.
- resumable uploads with upload session IDs.
2. Scan + parse chain
- antivirus scan (ClamAV or managed).
- PDF parser + OCR fallback.
- content hash + metadata extraction.
3. Security gating
- quarantine state until scan complete.
- block access if scan failed/suspicious.
- log every download/view attempt.

## 12) Database Schema (Detailed, Integrated)

### Logical required tables and physical mapping

| Required logical table | Physical object in this plan |
|---|---|
| tenants | `bureaus` (canonical) |
| users | `profiles` (canonical) |
| roles | `roles` (new) |
| permissions | `permissions` (new) |
| cases | `cases` (existing, extended with `tenant_id`) |
| documents | `case_documents` + `documents` (existing) |
| document_versions | `document_versions` (new) |
| messages | `portal_case_messages` (new, immutable) |
| audit_logs | `audit_logs` (new append-only) |
| notifications | `notifications` (existing, extended tenant scope) |
| sessions | `sessions` (new) |
| consents | `consents` (new) |
| ai_requests | `ai_requests` (new) |

### New/extended core columns
1. `tenant_id` on all portal-governed tables.
2. `sessions`:
- `refresh_token_hash`, `device_id`, `ip_address`, `user_agent_hash`, `two_factor_verified_at`, `revoked_at`.
3. `consents`:
- `consent_type`, `consent_version`, `accepted`, `withdrawn_at`, `proof_payload`.
4. `ai_requests`:
- `prompt_hash`, `status`, `confidence_score`, `policy_flags`, `prompt_injection_detected`, `disclaimer_shown`.
5. `audit_logs`:
- `event_type`, `object_type`, `request_id`, `result`, `reason_code`, `previous_hash`, `event_hash`.

## 13) API Design (REST)

### Auth & session
- `POST /api/portal/auth/login`
- `POST /api/portal/auth/refresh`
- `POST /api/portal/auth/2fa/send`
- `POST /api/portal/auth/2fa/verify`
- `GET /api/portal/sessions`
- `POST /api/portal/sessions/{id}/revoke`

### Cases
- `GET /api/portal/cases`
- `GET /api/portal/cases/{caseId}`
- `GET /api/portal/cases/{caseId}/timeline`
- `GET /api/portal/cases/{caseId}/documents`
- `GET /api/portal/cases/{caseId}/messages`
- `POST /api/portal/cases/{caseId}/messages`

### Documents
- `GET /api/portal/documents?caseId=&type=&from=&to=`
- `GET /api/portal/documents/{documentId}/signed-url`
- `GET /api/portal/documents/{documentId}/versions`

### AI
- `POST /api/portal/ai/summaries`
- `GET /api/portal/ai/requests/{requestId}`
- `POST /api/portal/ai/requests/{requestId}/report-incorrect`

### Notifications/calendar/search
- `GET /api/portal/notifications`
- `GET /api/portal/notifications/stream`
- `GET /api/portal/calendar/hearings`
- `POST /api/portal/calendar/google/sync`
- `GET /api/portal/search?q=`

### Compliance
- `GET /api/portal/consents`
- `POST /api/portal/consents`
- `POST /api/portal/compliance/export`
- `POST /api/portal/compliance/forget-me`

## 14) Frontend Architecture
1. App Router modules:
- `/portal` dashboard.
- `/portal/cases` list.
- `/portal/cases/[id]` detail (timeline, docs, messages, AI summary).
- `/portal/documents` global list.
- `/portal/calendar`.
- `/portal/settings/security`.
2. Data layer:
- React Query with tenant/case scoped query keys.
- optimistic updates only where safe (messaging send state).
3. Access control:
- server route guards + UI-level disabled controls for client role.
4. i18n + accessibility:
- TR/EN localization.
- WCAG-compliant focus states, contrast, keyboard navigation.
5. Mobile-first:
- card-first responsive layout.
- timeline and message threads optimized for narrow viewports.

## 15) Text Wireframes

### Dashboard
```
+------------------------------------------------------+
| Header: [Firma] [Bildirim] [Profil]                |
+------------------------------------------------------+
| Active Cases | Pending Actions | Upcoming Hearings  |
|      6       |        2        |         3          |
+------------------------------------------------------+
| Recent Activity                                  >   |
| - Dava A timeline update                           |
| - Belge X görüntülendi                             |
| - Avukat mesajı alındı                             |
+------------------------------------------------------+
```

### Case List
```
+------------------------------------------------------+
| Search [____]  Filter: Status | Court | Last Update |
+------------------------------------------------------+
| [OPEN]  Dosya: İş Davası  Last: 2026-03-28          |
| [IN_PROGRESS] Miras Dosyası Last: 2026-03-27        |
| [CLOSED] Tazminat Dosyası Last: 2026-03-20          |
+------------------------------------------------------+
```

### Case Detail
```
+------------------------------+-----------------------+
| Timeline                     | Case Summary          |
| 1. Dava açıldı               | Lawyer note           |
| 2. Dilekçe sunuldu           | AI summary (optional) |
| 3. Duruşma tarihi belirlendi | [Explain Process]     |
| 4. Karar bekleniyor          | Disclaimer shown      |
+------------------------------+-----------------------+
| Documents                                            |
| - Belge.pdf [View] [Download] [Versions]            |
+------------------------------------------------------+
| Messages (immutable thread)                          |
| [Client message input] [Send]                        |
+------------------------------------------------------+
```

## 16) DevOps & Deployment Plan
1. Environments
- `dev`, `staging`, `prod` separated DB/projects and secrets.
2. CI/CD gates
- lint + typecheck + tests + security scans + migration dry-run.
- policy tests for RLS and cross-tenant access.
3. Deployment
- blue/green or canary by tenant flag.
- migration first (additive), then API, then UI enablement.
4. Monitoring
- SLO dashboards for auth, portal API latency, error rates, queue lag.
- security alerts: failed login bursts, suspicious download patterns.

## 17) Backup, DR, Failover
1. Backups
- hourly WAL/incremental + daily full snapshots.
- object storage versioning + lifecycle.
2. Targets
- RPO: <= 1 hour
- RTO: <= 8 hours
3. Multi-region
- warm standby read replica in second region.
- failover runbook + quarterly game-day restore drills.

## 18) Edge Case Handling
1. Unauthorized ID access (IDOR)
- every object read/write path checks tenant + case linkage + role.
2. Race conditions
- optimistic concurrency (`updated_at` or revision token) on mutable entities.
- unique constraints for idempotency keys on message send and AI requests.
3. Concurrent updates
- server conflict response (`409`) with merge hints for client.
4. AI timeout/failure
- async fallback queue, retry policy, deterministic error contract.
5. Large uploads
- chunk retry with resumable upload tokens; partial chunk cleanup job.
6. Network failures
- retry with exponential backoff, offline-safe draft queue for message composer.

## 19) Rollout Checklist
1. Apply additive migration in staging.
2. Enable flags for internal test tenant only.
3. Run security regression (RLS, IDOR, permission matrix, signed URL expiration).
4. Pilot with 1-2 law firms.
5. Gradually increase tenant rollout percentage.
6. Enable mandatory audit export and consent enforcement before full GA.

