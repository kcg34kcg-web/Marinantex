import { z } from 'zod';

export const bubbleStateSchema = z.enum([
  'idle',
  'listening',
  'thinking',
  'working',
  'needs_confirmation',
  'success',
  'error',
]);

export const assistantPreferenceSchema = z.object({
  assistantName: z.string().min(2).max(60),
  tone: z.enum(['professional', 'warm', 'short', 'detailed']),
  language: z.enum(['tr', 'en']),
  responseLength: z.enum(['short', 'detailed']),
  proactiveLevel: z.number().int().min(0).max(3),
  quietHoursStart: z.number().int().min(0).max(23),
  quietHoursEnd: z.number().int().min(0).max(23),
  keyboardShortcut: z.string().min(2).max(24),
  bubblePositionX: z.number().int().min(0).max(4000),
  bubblePositionY: z.number().int().min(0).max(4000),
  bubbleSize: z.number().int().min(44).max(128),
  animationLevel: z.number().int().min(0).max(3),
  memoryEnabled: z.boolean(),
  requireConfirmationCritical: z.boolean(),
  temporaryMode: z.boolean(),
});

export const assistantMessageInputSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  attachments: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        size: z.number().int().min(0).max(25 * 1024 * 1024),
        type: z.string().min(1).max(120),
      }),
    )
    .max(5)
    .optional()
    .default([]),
  quickActionKey: z.string().min(1).max(80).optional(),
  routeContext: z
    .object({
      pathname: z.string().min(1).max(240).optional(),
      section: z.string().min(1).max(120).optional(),
      focus: z.string().min(1).max(120).optional(),
      entityType: z.string().min(1).max(80).optional(),
      entityId: z.string().min(1).max(120).optional(),
      focusType: z.enum(['case', 'task', 'client', 'general']).optional(),
      focusId: z.string().min(1).max(120).optional(),
      relatedEntityIds: z.array(z.string().min(1).max(120)).max(8).optional(),
      queryHints: z.array(z.string().min(1).max(120)).max(12).optional(),
      preferredTone: z.enum(['professional', 'warm', 'short', 'detailed']).optional(),
      preferredLength: z.enum(['short', 'detailed']).optional(),
      topCommands: z.array(z.string().min(1).max(80)).max(6).optional(),
    })
    .optional(),
});

export const toolExecuteInputSchema = z.object({
  conversationId: z.string().uuid().optional(),
  toolName: z.string().min(1).max(120),
  params: z.record(z.string(), z.unknown()).default({}),
  confirmation: z
    .object({
      approved: z.boolean(),
      executionId: z.string().uuid().optional(),
    })
    .optional(),
});

export const memoryCreateSchema = z.object({
  kind: z.enum(['NOTE', 'PREFERENCE', 'FACT']),
  content: z.string().min(1).max(800),
  tags: z.array(z.string().min(1).max(40)).max(10).optional().default([]),
});

export const memoryDeleteSchema = z.object({
  id: z.string().uuid(),
});

export const assistantStructuredOutputSchema = z.object({
  intent: z.string().min(1).max(120),
  reply: z.string().min(1).max(4000),
  actions: z
    .array(
      z.object({
        toolName: z.string().min(1).max(120),
        params: z.record(z.string(), z.unknown()).default({}),
        reason: z.string().max(240).optional(),
      }),
    )
    .max(4)
    .default([]),
  needsConfirmation: z.boolean().default(false),
  suggestions: z.array(z.string().min(1).max(160)).max(6).default([]),
  memoryWrites: z
    .array(
      z.object({
        kind: z.enum(['NOTE', 'PREFERENCE', 'FACT']),
        content: z.string().min(1).max(400),
        tags: z.array(z.string().min(1).max(40)).max(8).optional(),
      }),
    )
    .max(4)
    .default([]),
});

export const assistantStyleProfileSchema = z.object({
  preferredTone: z.enum(['professional', 'warm', 'short', 'detailed']),
  preferredLength: z.enum(['short', 'detailed']),
  commandCounters: z.record(z.string(), z.number().int().min(0).max(10000)).default({}),
});

export type AssistantStructuredOutput = z.infer<typeof assistantStructuredOutputSchema>;
export type AssistantMessageInput = z.infer<typeof assistantMessageInputSchema>;
export type AssistantPreferenceInput = z.infer<typeof assistantPreferenceSchema>;
export type ToolExecuteInput = z.infer<typeof toolExecuteInputSchema>;
export type AssistantStyleProfileInput = z.infer<typeof assistantStyleProfileSchema>;
