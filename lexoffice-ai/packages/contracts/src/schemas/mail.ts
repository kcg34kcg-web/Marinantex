import { z } from "zod";

export const threadViewSchema = z.enum([
  "inbox",
  "unread",
  "starred",
  "important",
  "drafts",
  "sent",
  "trash",
  "spam",
  "archive",
  "label"
]);

export const threadReadStatusSchema = z.enum(["all", "read", "unread"]);
export const threadSortBySchema = z.enum(["date", "sender"]);
export const threadSortDirectionSchema = z.enum(["asc", "desc"]);

export const listThreadsSchema = z.object({
  tenantId: z.string().cuid(),
  mailboxId: z.string().cuid().optional(),
  query: z.string().min(1).max(250).optional(),
  view: threadViewSchema.default("inbox"),
  labelId: z.string().cuid().optional(),
  readStatus: threadReadStatusSchema.default("all"),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  withAttachments: z.boolean().default(false),
  onlyStarred: z.boolean().default(false),
  sortBy: threadSortBySchema.default("date"),
  sortDirection: threadSortDirectionSchema.default("desc"),
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

export const updateMessageFlagsSchema = z
  .object({
    tenantId: z.string().cuid(),
    messageId: z.string().cuid(),
    isStarred: z.boolean().optional(),
    isImportant: z.boolean().optional()
  })
  .refine((input) => input.isStarred !== undefined || input.isImportant !== undefined, {
    message: "isStarred veya isImportant alanlarından en az biri gönderilmelidir."
  });

export const updateMessageStateSchema = z.object({
  tenantId: z.string().cuid(),
  messageId: z.string().cuid(),
  state: z.enum(["RECEIVED", "ARCHIVED", "TRASH", "SPAM", "SENT", "DRAFT"])
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
      z.union([
        z.object({
          kind: z.literal("staged"),
          attachmentToken: z.string().min(32),
          name: z.string().min(1).max(255),
          mimeType: z.string().min(1).max(120),
          sizeBytes: z.coerce.number().int().positive().max(25 * 1024 * 1024)
        }),
        z.object({
          kind: z.literal("inline").optional(),
          name: z.string().min(1).max(255),
          contentBase64: z.string().min(1),
          mimeType: z.string().min(1).max(120)
        })
      ])
    )
    .max(10)
    .default([])
});

export const scheduleSendMailSchema = sendMailSchema.extend({
  scheduledAt: z.string().datetime(),
  undoWindowSeconds: z.coerce.number().int().min(5).max(120).optional()
});

export const cancelScheduledSendSchema = z.object({
  tenantId: z.string().cuid(),
  scheduledDraftId: z.string().cuid()
});

export const linkThreadToMatterSchema = z.object({
  tenantId: z.string().cuid(),
  threadId: z.string().cuid(),
  matterId: z.string().cuid(),
  note: z.string().max(2_000).optional()
});

export const createMailLabelSchema = z.object({
  tenantId: z.string().cuid(),
  mailboxId: z.string().cuid(),
  name: z.string().min(1).max(120),
  color: z.string().min(3).max(30).optional()
});

export const toggleMessageLabelSchema = z.object({
  tenantId: z.string().cuid(),
  messageId: z.string().cuid(),
  labelId: z.string().cuid(),
  action: z.enum(["add", "remove"]).default("add")
});

export type ListThreadsInput = z.infer<typeof listThreadsSchema>;
export type TriggerSyncInput = z.infer<typeof triggerSyncSchema>;
export type SendMailInput = z.infer<typeof sendMailSchema>;
export type ScheduleSendMailInput = z.infer<typeof scheduleSendMailSchema>;
export type LinkThreadToMatterInput = z.infer<typeof linkThreadToMatterSchema>;
export type ThreadView = z.infer<typeof threadViewSchema>;
