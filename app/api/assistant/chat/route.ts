import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import { buildAssistantPlan, persistMemoryWrites } from '@/lib/assistant/orchestrator';
import { dedupeClientDirectives, extractClientDirectivesFromToolOutput } from '@/lib/assistant/client-directives';
import { checkAssistantRateLimit } from '@/lib/assistant/rate-limit';
import {
  appendMessage,
  createToolExecutionLog,
  ensureConversationForUser,
  finalizeToolExecution,
  getAssistantPreference,
  getConversationMessages,
  writeAuditLog,
} from '@/lib/assistant/repository';
import { streamAssistantReply } from '@/lib/gemini/assistant-chat';
import { getTool, hasToolPermission, mapQuickActionToTool } from '@/lib/tools/registry';
import { assistantMessageInputSchema } from '@/lib/validators/assistant';
import { buildAssistantSystemPrompt } from '@/lib/assistant/system-prompt';
import type { AssistantClientDirective } from '@/types/assistant';

export const runtime = 'nodejs';
export const maxDuration = 60;

const streamModeSchema = z.object({
  stream: z.boolean().optional().default(true),
});

type PendingAction = {
  executionId: string;
  toolName: string;
  summary: string;
  preview: Record<string, unknown>;
  params: Record<string, unknown>;
  requiresConfirmation: boolean;
};

type UndoOption = {
  toolName: string;
  params: Record<string, unknown>;
  label: string;
  expiresInSec: number;
};

function buildTitleFromMessage(message: string) {
  const clean = message.replace(/\s+/g, ' ').trim();
  return clean.slice(0, 80) || 'Yeni sohbet';
}

function extractUndoOption(output: unknown): UndoOption | null {
  if (typeof output !== 'object' || output === null) {
    return null;
  }

  const rawUndo = (output as Record<string, unknown>).undo;
  if (typeof rawUndo !== 'object' || rawUndo === null) {
    return null;
  }

  const undo = rawUndo as Record<string, unknown>;
  if (
    typeof undo.toolName !== 'string' ||
    typeof undo.label !== 'string' ||
    typeof undo.expiresInSec !== 'number' ||
    typeof undo.params !== 'object' ||
    undo.params === null
  ) {
    return null;
  }

  return {
    toolName: undo.toolName,
    params: undo.params as Record<string, unknown>,
    label: undo.label,
    expiresInSec: Math.min(30, Math.max(10, Math.floor(undo.expiresInSec))),
  };
}

function dedupeUndoOptions(items: UndoOption[]) {
  const seen = new Set<string>();
  const unique: UndoOption[] = [];
  for (const item of items) {
    const key = `${item.toolName}:${JSON.stringify(item.params)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function splitDraftToChunks(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 6) {
    chunks.push(`${words.slice(i, i + 6).join(' ')} `);
  }
  return chunks.length > 0 ? chunks : [text];
}

function shouldRewriteAssistantDraft() {
  return process.env.ASSISTANT_REWRITE_STREAM === 'true';
}

async function* safeReplyStream(input: { systemPrompt: string; reply: string; language: 'tr' | 'en' }) {
  try {
    for await (const token of streamAssistantReply(input)) {
      yield token;
    }
  } catch {
    for (const token of splitDraftToChunks(input.reply)) {
      yield token;
    }
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
  }

  const rate = checkAssistantRateLimit({
    key: `assistant-chat:${user.id}`,
    limit: 40,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return Response.json(
      {
        error: 'Çok sık istek gönderildi. Lütfen birkaç saniye bekleyip tekrar deneyin.',
        retryAt: rate.resetAt,
      },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = assistantMessageInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz sohbet isteği.' }, { status: 400 });
  }

  const streamPreference = streamModeSchema.safeParse(body);
  const { message, quickActionKey, routeContext } = parsed.data;
  const shouldStream = streamPreference.success ? streamPreference.data.stream : true;
  const preferences = await getAssistantPreference(user);

  const conversation = await ensureConversationForUser(user, {
    conversationId: parsed.data.conversationId,
    fallbackTitle: buildTitleFromMessage(message),
    isTemporary: preferences.temporaryMode,
  });

  await appendMessage({
    user,
    conversationId: conversation.id,
    role: 'user',
    content: message,
    metadata: {
      source: 'assistant_panel',
      routeContext: routeContext ?? null,
      quickActionKey: quickActionKey ?? null,
      attachments: parsed.data.attachments,
    },
  });

  const historyMessages = await getConversationMessages(user, conversation.id);
  const historyForModel = historyMessages
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .slice(-10)
    .map((item) => ({
      role: item.role as 'user' | 'assistant',
      content: item.content,
    }));

  const planResult = await buildAssistantPlan({
    user,
    message: quickActionKey ? `${message}\nHızlı aksiyon anahtarı: ${quickActionKey}` : message,
    history: historyForModel,
    quickActionKey,
    routeContext,
  });

  if (preferences.memoryEnabled) {
    await persistMemoryWrites(user, planResult.plan.memoryWrites);
  }

  const pendingActions: PendingAction[] = [];
  const autoExecutionSummaries: string[] = [];
  const clientDirectives: AssistantClientDirective[] = [];
  const undoOptions: UndoOption[] = [];
  const actions = [...planResult.plan.actions];
  const mappedFromQuickAction = quickActionKey ? mapQuickActionToTool(quickActionKey) : null;
  if (mappedFromQuickAction && actions.length === 0) {
    actions.push({
      toolName: mappedFromQuickAction.toolName,
      params: mappedFromQuickAction.params,
    });
  }

  for (const action of actions.slice(0, 2)) {
    const tool = getTool(action.toolName);
    if (!tool) {
      continue;
    }

    const toolContext = { user, now: new Date() };
    if (!hasToolPermission(toolContext, tool.name)) {
      autoExecutionSummaries.push(`${tool.label} için yetki bulunamadı.`);
      continue;
    }

    try {
      const preview = await tool.preview({
        context: toolContext,
        params: action.params,
      });

      const executionId = await createToolExecutionLog({
        user,
        conversationId: conversation.id,
        toolName: tool.name,
        params: action.params as Prisma.InputJsonValue,
        preview: preview.preview as Prisma.InputJsonValue,
        requiresConfirmation: preview.requiresConfirmation || tool.requiresConfirmation || planResult.plan.needsConfirmation,
      });

      const needsConfirmation = preview.requiresConfirmation || tool.requiresConfirmation || planResult.plan.needsConfirmation;
      if (needsConfirmation) {
        pendingActions.push({
          executionId,
          toolName: tool.name,
          summary: preview.summary,
          preview: preview.preview,
          params: action.params,
          requiresConfirmation: true,
        });
        continue;
      }

      const result = await tool.run({
        context: toolContext,
        params: action.params,
      });

      await finalizeToolExecution({
        executionId,
        userId: user.id,
        success: true,
        output: result.output as Prisma.InputJsonValue,
        confirmed: true,
      });

      const extracted = extractClientDirectivesFromToolOutput(result.output);
      if (extracted.length > 0) {
        clientDirectives.push(...extracted);
      }
      const undo = extractUndoOption(result.output);
      if (undo) {
        undoOptions.push(undo);
      }

      autoExecutionSummaries.push(result.summary);
      await writeAuditLog({
        user,
        category: 'tool_execution',
        action: tool.name,
        summary: result.summary,
        details: {
          output: result.output,
        } as Prisma.InputJsonValue,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Bilinmeyen hata';
      autoExecutionSummaries.push(`${tool.label} çalıştırılamadı: ${reason}`);
    }
  }

  const finalDraft =
    autoExecutionSummaries.length > 0
      ? `${planResult.plan.reply}\n\nİşlem özeti:\n- ${autoExecutionSummaries.join('\n- ')}`
      : planResult.plan.reply;
  const dedupedDirectives = dedupeClientDirectives(clientDirectives);
  const dedupedUndoOptions = dedupeUndoOptions(undoOptions);

  const systemPrompt = buildAssistantSystemPrompt({
    language: preferences.language,
    tone: preferences.tone,
    assistantName: preferences.assistantName,
    userName: user.name,
    memoryEnabled: preferences.memoryEnabled,
    requireConfirmationCritical: preferences.requireConfirmationCritical,
  });
  const rewriteAssistantDraft = shouldRewriteAssistantDraft();

  if (!shouldStream) {
    let reply = finalDraft;
    if (rewriteAssistantDraft) {
      try {
        let merged = '';
        for await (const token of safeReplyStream({
          systemPrompt,
          reply: finalDraft,
          language: preferences.language,
        })) {
          merged += token;
        }
        if (merged.trim()) {
          reply = merged.trim();
        }
      } catch {
        // fallback olarak taslak cevabı bırak
      }
    }

    const saved = await appendMessage({
      user,
      conversationId: conversation.id,
      role: 'assistant',
      content: reply,
      metadata: {
        intent: planResult.plan.intent,
        suggestions: planResult.plan.suggestions,
        pendingActions,
        clientDirectives: dedupedDirectives,
        undoOptions: dedupedUndoOptions,
      } as unknown as Prisma.InputJsonValue,
    });

    return Response.json({
      conversationId: conversation.id,
      messageId: saved.id,
      reply,
      suggestions: planResult.plan.suggestions,
      pendingActions,
      clientDirectives: dedupedDirectives,
      undoOptions: dedupedUndoOptions,
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let accumulated = '';

      const emit = (eventName: string, payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      emit('meta', {
        conversationId: conversation.id,
        pendingActions,
        suggestions: planResult.plan.suggestions,
        clientDirectives: dedupedDirectives,
        undoOptions: dedupedUndoOptions,
      });

      try {
        if (rewriteAssistantDraft) {
          for await (const token of safeReplyStream({
            systemPrompt,
            reply: finalDraft,
            language: preferences.language,
          })) {
            accumulated += token;
            emit('token', { token });
          }
        } else {
          for (const token of splitDraftToChunks(finalDraft)) {
            accumulated += token;
            emit('token', { token });
          }
        }

        const finalText = accumulated.trim() || finalDraft;
        const saved = await appendMessage({
          user,
          conversationId: conversation.id,
          role: 'assistant',
          content: finalText,
          metadata: {
            intent: planResult.plan.intent,
            suggestions: planResult.plan.suggestions,
            pendingActions,
            clientDirectives: dedupedDirectives,
            undoOptions: dedupedUndoOptions,
          } as unknown as Prisma.InputJsonValue,
        });

        emit('done', {
          conversationId: conversation.id,
          messageId: saved.id,
          reply: finalText,
          suggestions: planResult.plan.suggestions,
          pendingActions,
          clientDirectives: dedupedDirectives,
          undoOptions: dedupedUndoOptions,
        });
      } catch (error) {
        const fallbackMessage = 'Yanıt üretirken geçici bir hata oldu. İstersen tekrar deneyelim.';
        await appendMessage({
          user,
          conversationId: conversation.id,
          role: 'assistant',
          content: fallbackMessage,
          metadata: {
            error: error instanceof Error ? error.message : 'unknown',
          },
        });
        emit('error', {
          message: fallbackMessage,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
