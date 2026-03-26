import { z } from "zod";
import { sendMailSchema } from "./mail";

export const mailSyncJobSchema = z.object({
  tenantId: z.string().cuid(),
  mailboxId: z.string().cuid(),
  triggeredByUserId: z.string().cuid().optional(),
  mode: z.enum(["initial", "incremental"]).default("incremental"),
  correlationId: z.string().min(8)
});

export const attachmentVirusScanJobSchema = z.object({
  tenantId: z.string().cuid(),
  attachmentId: z.string().cuid(),
  correlationId: z.string().min(8),
  triggeredByUserId: z.string().cuid().optional()
});

export const scheduledMailSendJobSchema = z.object({
  tenantId: z.string().cuid(),
  actorUserId: z.string().cuid(),
  scheduledDraftId: z.string().cuid(),
  sendPayload: sendMailSchema,
  correlationId: z.string().min(8)
});

export type MailSyncJobPayload = z.infer<typeof mailSyncJobSchema>;
export type AttachmentVirusScanJobPayload = z.infer<typeof attachmentVirusScanJobSchema>;
export type ScheduledMailSendJobPayload = z.infer<typeof scheduledMailSendJobSchema>;
