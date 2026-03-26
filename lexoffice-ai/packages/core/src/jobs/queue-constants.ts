export const QUEUES = {
  MAIL_SYNC: "lexoffice-mail-sync",
  DOMAIN_HEALTH: "lexoffice-domain-health",
  AI_ACTION: "lexoffice-ai-action",
  MAIL_DELIVERY: "lexoffice-mail-delivery",
  ATTACHMENTS: "lexoffice-attachments",
  NOTIFICATIONS: "lexoffice-notifications",
  WEBHOOKS: "lexoffice-webhooks",
  SECURITY: "lexoffice-security"
} as const;

export const JOB_NAMES = {
  MAIL_SYNC_RUN: "mail.sync.run",
  MAIL_SYNC_INITIAL: "mail.sync.initial",
  MAIL_SYNC_INCREMENTAL: "mail.sync.incremental",
  PROVIDER_TOKEN_REFRESH: "provider.token.refresh",
  MAIL_SEND_SCHEDULED: "mail.send.scheduled",
  ATTACHMENT_FETCH: "attachment.fetch",
  ATTACHMENT_VIRUS_SCAN: "attachment.virus.scan",
  DOMAIN_VERIFY_CHECK: "domain.verify.check",
  DOMAIN_DNS_HEALTH_RECHECK: "domain.dns.health.recheck",
  AI_MAIL_ACTION: "ai.mail.action",
  AI_SUMMARIZATION: "ai.summarization",
  AI_TASK_EXTRACTION: "ai.task.extraction",
  WEBHOOK_PROCESS: "webhook.process",
  NOTIFICATION_DISPATCH: "notification.dispatch"
} as const;
