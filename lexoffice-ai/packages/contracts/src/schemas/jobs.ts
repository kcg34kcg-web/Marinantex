import { z } from "zod";

export const mailSyncJobSchema = z.object({
  tenantId: z.string().cuid(),
  mailboxId: z.string().cuid(),
  triggeredByUserId: z.string().cuid().optional(),
  mode: z.enum(["initial", "incremental"]).default("incremental"),
  correlationId: z.string().min(8)
});

export type MailSyncJobPayload = z.infer<typeof mailSyncJobSchema>;
