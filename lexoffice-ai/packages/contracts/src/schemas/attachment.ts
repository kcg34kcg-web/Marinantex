import { z } from "zod";

export const createAttachmentUploadUrlSchema = z.object({
  tenantId: z.string().cuid(),
  mailboxId: z.string().cuid(),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.coerce.number().int().positive().max(25 * 1024 * 1024)
});

export const createAttachmentDownloadTokenSchema = z.object({
  tenantId: z.string().cuid(),
  attachmentId: z.string().cuid()
});

export type CreateAttachmentUploadUrlInput = z.infer<typeof createAttachmentUploadUrlSchema>;
export type CreateAttachmentDownloadTokenInput = z.infer<typeof createAttachmentDownloadTokenSchema>;
