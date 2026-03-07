export const QUEUES = {
  MAIL_SYNC: "lexoffice:mail-sync",
  DOMAIN_HEALTH: "lexoffice:domain-health",
  AI_ACTION: "lexoffice:ai-action"
} as const;

export const JOB_NAMES = {
  MAIL_SYNC_RUN: "mail.sync.run",
  DOMAIN_VERIFY_CHECK: "domain.verify.check",
  AI_MAIL_ACTION: "ai.mail.action"
} as const;
