# Frontend Information Architecture

## Route Planı

- `/(auth)/sign-in`
- `/(onboarding)/create-office`
- `/(app)/[tenantSlug]/dashboard`
- `/(app)/[tenantSlug]/mail`
- `/(app)/[tenantSlug]/mail/[threadId]`
- `/(app)/[tenantSlug]/mail/compose`
- `/(app)/[tenantSlug]/clients`
- `/(app)/[tenantSlug]/matters`
- `/(app)/[tenantSlug]/tasks`
- `/(app)/[tenantSlug]/ai`
- `/(app)/[tenantSlug]/settings`
- `/(app)/[tenantSlug]/settings/domains`
- `/(app)/[tenantSlug]/admin/audit`

## Bilgi Mimarisi

- **Workspace Scope**: tüm uygulama route’ları tenant slug altında izole edilir.
- **Operational Core**: mail, matters, tasks, ai workspace aynı shell içinde entegre çalışır.
- **Admin Surface**: settings + audit ekranları role/permission kontrolüyle ayrılır.
- **Wizards**: domain onboarding ve mailbox connect adım adım, hataya dayanıklı akışlarla yürütülür.

## Ana Bileşen Ağacı

- `AppShell`
- `Sidebar`
- `Topbar`
- `MailWorkspace`
- `MailSidebar`
- `MailList`
- `MailListItem`
- `SearchBar`
- `FilterBar`
- `SyncStatusBadge`
- `MailThreadView`
- `ComposeEditor`
- `RecipientChips`
- `AttachmentUploader`
- `AIActionPanel`
- `MatterLinkPanel`
- `DomainManagementPanel`
- `DomainWizard`
- `MailboxConnectWizard`
- `AuditTable`
- `SettingsForms`

## State Yönetimi

- **Server Components**
- Tenant context fetch
- Initial thread/mailbox/domain payload hydration
- Auth-protected shell rendering

- **Client Components**
- Search/filter state
- Mail list selection state
- Compose draft state + autosave timers
- AI action request/response state
- AI SSE stream state + tenant AI metrics state
- Wizard step states

- **Data Fetching**
- Route handlers + fetch wrappers
- Suspense sınırları
- Optimistic update: draft autosave, mark read/unread, AI feedback
- Infinite scroll: cursor tabanlı thread yükleme
- Keyboard UX: `j/k`, `enter`, `e`, `x`, `c`, `r` kısayolları

## Loading / Empty / Error State Tasarımı

- **Loading**
- Mail list skeleton
- Thread detail skeleton
- Domain DNS check progress

- **Empty**
- Inbox boşsa mailbox bağlantı CTA
- Domain yoksa onboarding CTA
- Matter link yoksa hızlı bağlama paneli

- **Error**
- Sync error banner + retry action
- Token expired reconnect prompt
- AI action failure state + fallback message
- AI stream failure state + non-stream fallback

## Mobile Davranışları

- Sidebar collapse + üst menüden hızlı geçiş.
- Mail list ve thread ayrı route akışı ile okunabilirlik korunur.
- Compose ekranı full page açılır; recipient chips tek kolon davranır.
- Matter/AI panelleri drawer modal olarak açılır.
