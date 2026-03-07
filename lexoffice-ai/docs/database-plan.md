# Database Migration Plan

## Migration Sırası

1. Identity ve tenancy
- `Tenant`, `TenantSettings`, `User`, `Membership`, `Role`, `Permission`, `RolePermission`, `UserSession`

2. Governance
- `AuditLog`, `SecurityEvent`, `FeatureFlag`, `SubscriptionPlan`, `UsageRecord`

3. Domain + mailbox foundation
- `Domain`, `DomainVerification`, `DomainDnsRecord`
- `Mailbox`, `MailboxConnection`, `MailboxAlias`, `MailboxPermission`, `MailboxSyncState`

4. Mail domain layer
- `MailThread`, `MailMessage`, `MailRecipient`, `MailAttachment`, `MailLabel`, `MailMessageLabel`, `MailFolder`, `Draft`, `Signature`

5. CRM / Matter
- `Contact`, `Client`, `Matter`, `MatterContact`, `MatterMessage`, `Task`, `Deadline`, `Document`

6. AI + integrations + jobs
- `AIConversation`, `AIMessage`, `ProviderToken`, `Webhook`, `BackgroundJob`, `Notification`

## Seed Planı

- Plan ve permission catalogue
- System role bootstrap
- Demo tenant + owner membership
- Demo domain + DNS records
- Demo mailbox + sync state
- Demo thread + message
