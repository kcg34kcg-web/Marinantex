import { z } from "zod";

export const listThreadsSchema = z.object({
  tenantId: z.string().cuid(),
  mailboxId: z.string().cuid().optional(),
  query: z.string().min(1).max(250).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().datetime().optional()
});

export const getThreadSchema = z.object({
  tenantId: z.string().cuid(),
  threadId: z.string().cuid()
});

export const markMessageReadSchema = z.object({
  tenantId: z.string().cuid(),
  messageId: z.string().cuid(),
  read: z.boolean()
});

export const triggerSyncSchema = z.object({
  tenantId: z.string().cuid(),
  mailboxId: z.string().cuid(),
  mode: z.enum(["initial", "incremental"]).default("incremental")
});

export const createDraftSchema = z.object({
  draftId: z.string().cuid().optional(),
  tenantId: z.string().cuid(),
  mailboxId: z.string().cuid(),
  subject: z.string().max(200).optional(),
  bodyText: z.string().max(100_000).optional(),
  toRecipients: z.array(z.string().email()).default([]),
  ccRecipients: z.array(z.string().email()).default([]),
  bccRecipients: z.array(z.string().email()).default([])
});

export const sendMailSchema = z.object({
  tenantId: z.string().cuid(),
  mailboxId: z.string().cuid(),
  threadId: z.string().cuid().optional(),
  inReplyToMessageId: z.string().cuid().optional(),
  subject: z.string().max(200).default(""),
  bodyText: z.string().max(100_000).optional(),
  bodyHtml: z.string().max(200_000).optional(),
  toRecipients: z.array(z.string().email()).min(1),
  ccRecipients: z.array(z.string().email()).default([]),
  bccRecipients: z.array(z.string().email()).default([]),
  attachments: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        contentBase64: z.string().min(1),
        mimeType: z.string().min(1).max(120)
      })
    )
    .max(10)
    .default([])
});

export const linkThreadToMatterSchema = z.object({
  tenantId: z.string().cuid(),
  threadId: z.string().cuid(),
  matterId: z.string().cuid(),
  note: z.string().max(2_000).optional()
});

export type ListThreadsInput = z.infer<typeof listThreadsSchema>;
export type TriggerSyncInput = z.infer<typeof triggerSyncSchema>;
export type SendMailInput = z.infer<typeof sendMailSchema>;
export type LinkThreadToMatterInput = z.infer<typeof linkThreadToMatterSchema>;
