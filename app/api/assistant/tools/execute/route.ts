import type { Prisma } from '@prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import { dedupeClientDirectives, extractClientDirectivesFromToolOutput } from '@/lib/assistant/client-directives';
import { checkAssistantRateLimit } from '@/lib/assistant/rate-limit';
import { createToolExecutionLog, finalizeToolExecution, writeAuditLog } from '@/lib/assistant/repository';
import { getTool, hasToolPermission } from '@/lib/tools/registry';
import { toolExecuteInputSchema } from '@/lib/validators/assistant';

export const runtime = 'nodejs';

function extractUndoOption(output: unknown) {
  if (typeof output !== 'object' || output === null) {
    return null;
  }
  const candidate = (output as Record<string, unknown>).undo;
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }
  const undo = candidate as Record<string, unknown>;
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

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
  }

  const rate = checkAssistantRateLimit({
    key: `assistant-tool:${user.id}`,
    limit: 80,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return Response.json({ error: 'Çok fazla işlem denemesi yapıldı.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = toolExecuteInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz araç isteği.' }, { status: 400 });
  }

  const tool = getTool(parsed.data.toolName);
  if (!tool) {
    return Response.json({ error: 'Araç bulunamadı.' }, { status: 404 });
  }

  const toolContext = { user, now: new Date() };
  if (!hasToolPermission(toolContext, tool.name)) {
    return Response.json({ error: 'Bu araç için yetkiniz yok.' }, { status: 403 });
  }

  try {
    const preview = await tool.preview({
      params: parsed.data.params,
      context: toolContext,
    });

    const requiresConfirmation = tool.requiresConfirmation || preview.requiresConfirmation;
    const executionId =
      parsed.data.confirmation?.executionId ??
      (await createToolExecutionLog({
        user,
        conversationId: parsed.data.conversationId,
        toolName: tool.name,
        params: parsed.data.params as Prisma.InputJsonValue,
        preview: preview.preview as Prisma.InputJsonValue,
        requiresConfirmation,
      }));

    if (requiresConfirmation && !parsed.data.confirmation) {
      return Response.json({
        executionId,
        toolName: tool.name,
        status: 'PREVIEW',
        summary: preview.summary,
        output: preview.preview,
        requiresConfirmation: true,
      });
    }

    if (requiresConfirmation && parsed.data.confirmation && !parsed.data.confirmation.approved) {
      await finalizeToolExecution({
        executionId,
        userId: user.id,
        success: false,
        confirmed: false,
        output: { canceled: true } as Prisma.InputJsonValue,
      });

      return Response.json({
        executionId,
        toolName: tool.name,
        status: 'CANCELED',
        summary: 'İşlem kullanıcı tarafından iptal edildi.',
      });
    }

    const result = await tool.run({
      params: parsed.data.params,
      context: toolContext,
    });
    const clientDirectives = dedupeClientDirectives(extractClientDirectivesFromToolOutput(result.output));
    const undoOption = extractUndoOption(result.output);

    await finalizeToolExecution({
      executionId,
      userId: user.id,
      success: true,
      confirmed: true,
      output: result.output as Prisma.InputJsonValue,
    });

    await writeAuditLog({
      user,
      category: 'tool_execution',
      action: tool.name,
      summary: result.summary,
      details: {
        output: result.output,
        confirmed: true,
      } as Prisma.InputJsonValue,
    });

    return Response.json({
      executionId,
      toolName: tool.name,
      status: 'EXECUTED',
      summary: result.summary,
      output: result.output,
      undoOption,
      clientDirectives,
      requiresConfirmation,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Araç çalıştırılamadı.',
      },
      { status: 500 },
    );
  }
}
