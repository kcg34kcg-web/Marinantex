import { z } from "zod";

export const aiActionTypeEnum = z.enum([
  "MAIL_SUMMARY",
  "MAIL_REPLY_PROFESSIONAL",
  "MAIL_REPLY_SHORT",
  "MAIL_REPLY_FORMAL",
  "THREAD_TASK_EXTRACTION",
  "THREAD_ACTION_LIST",
  "THREAD_MATTER_SUMMARY",
  "SENSITIVE_DATA_CHECK"
]);

export const runAiMailActionSchema = z.object({
  tenantId: z.string().cuid(),
  threadId: z.string().cuid(),
  messageId: z.string().cuid().optional(),
  action: aiActionTypeEnum,
  preferredLanguage: z.enum(["tr", "en"]).default("tr"),
  stream: z.boolean().default(false)
});

const aiSummaryOutputSchema = z.object({
  type: z.literal("summary"),
  bullets: z.array(z.string()).max(5),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  nextStep: z.string().min(1)
});

const aiReplyOutputSchema = z.object({
  type: z.literal("reply"),
  tone: z.enum(["professional", "short", "formal"]),
  subjectSuggestion: z.string().min(1),
  body: z.string().min(1)
});

const aiTaskOutputSchema = z.object({
  type: z.literal("tasks"),
  tasks: z
    .array(
      z.object({
        title: z.string().min(1),
        ownerSuggestion: z.string().min(1).optional(),
        dueDateSuggestion: z.string().min(1).optional()
      })
    )
    .min(1)
});

const aiMatterSummaryOutputSchema = z.object({
  type: z.literal("matter_summary"),
  topic: z.string().min(1),
  riskSummary: z.string().min(1),
  nextSteps: z.array(z.string()).min(1)
});

const aiSensitiveCheckOutputSchema = z.object({
  type: z.literal("sensitive_check"),
  containsSensitiveData: z.boolean(),
  categories: z.array(z.string()),
  recommendation: z.string().min(1)
});

export const aiStructuredOutputSchema = z.discriminatedUnion("type", [
  aiSummaryOutputSchema,
  aiReplyOutputSchema,
  aiTaskOutputSchema,
  aiMatterSummaryOutputSchema,
  aiSensitiveCheckOutputSchema
]);

export const runAiMailActionResponseSchema = z.object({
  aiMessageId: z.string().cuid(),
  action: aiActionTypeEnum,
  suggestion: z.string().min(1),
  structuredOutput: aiStructuredOutputSchema,
  humanApprovalRequired: z.boolean(),
  usage: z.object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0)
  })
});

export const aiSuggestionFeedbackSchema = z.object({
  tenantId: z.string().cuid(),
  aiMessageId: z.string().cuid(),
  accepted: z.boolean()
});

export const aiStatsQuerySchema = z.object({
  tenantId: z.string().cuid()
});

const aiStatsBucketSchema = z.object({
  suggestions: z.number().int().min(0),
  accepted: z.number().int().min(0),
  rejected: z.number().int().min(0),
  pendingFeedback: z.number().int().min(0),
  acceptanceRate: z.number().min(0).max(1)
});

export const aiStatsResponseSchema = z.object({
  tenantId: z.string().cuid(),
  asOf: z.string().datetime(),
  totals: aiStatsBucketSchema,
  currentMonth: aiStatsBucketSchema,
  tokenUsage: z.object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0)
  }),
  byAction: z.array(
    z.object({
      action: aiActionTypeEnum,
      suggestions: z.number().int().min(0),
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
      totalTokens: z.number().int().min(0)
    })
  )
});

export type RunAiMailActionInput = z.infer<typeof runAiMailActionSchema>;
export type AIActionType = z.infer<typeof aiActionTypeEnum>;
export type AIStructuredOutput = z.infer<typeof aiStructuredOutputSchema>;
export type RunAiMailActionResponse = z.infer<typeof runAiMailActionResponseSchema>;
export type AIStatsResponse = z.infer<typeof aiStatsResponseSchema>;
