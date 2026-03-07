export const PERMISSIONS = {
  MAILBOX_VIEW: "mailbox.view",
  MAILBOX_CONNECT: "mailbox.connect",
  MAILBOX_CREATE: "mailbox.create",
  MAIL_SEND: "mail.send",
  MAIL_DRAFT_SAVE: "mail.draft.save",
  MAIL_LABEL_MANAGE: "mail.label.manage",
  MAIL_AI_COMPOSE: "mail.ai.compose",
  FILE_UPLOAD: "file.upload",
  CLIENT_MATTER_ACCESS: "client.matter.access",
  USER_INVITE: "user.invite",
  BILLING_VIEW: "billing.view",
  DOMAIN_MANAGE: "domain.manage",
  AUDIT_VIEW: "audit.view",
  SECURITY_MANAGE: "security.manage",
  AI_WORKSPACE: "ai.workspace",
  ADMIN_ALL: "admin.all"
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
