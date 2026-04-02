import { buildAssistantSystemPrompt } from '@/lib/assistant/system-prompt';
import { createMemoryItem, getAssistantPreference } from '@/lib/assistant/repository';
import { generateAssistantPlan } from '@/lib/gemini/assistant-chat';
import { assistantStructuredOutputSchema } from '@/lib/validators/assistant';
import { mapQuickActionToTool } from '@/lib/tools/registry';
import { resolveDeterministicAssistantCommand } from '@/lib/assistant/command-router';
import type { SessionUser } from '@/lib/auth/session';
import type { AssistantActionPlan } from '@/types/assistant';

interface BuildPlanInput {
  user: SessionUser;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  quickActionKey?: string;
  routeContext?: {
    pathname?: string;
    section?: string;
    focus?: string;
    entityType?: string;
    entityId?: string;
    focusType?: 'case' | 'task' | 'client' | 'general';
    focusId?: string;
    relatedEntityIds?: string[];
    queryHints?: string[];
    preferredTone?: 'professional' | 'warm' | 'short' | 'detailed';
    preferredLength?: 'short' | 'detailed';
    topCommands?: string[];
  };
}

function inferIntentFromText(message: string) {
  const normalized = message.toLocaleLowerCase('tr-TR');
  if (normalized.includes('bugünü özet')) return 'office.summary';
  if (normalized.includes('mail')) return 'mail.summary';
  if (normalized.includes('toplant')) return 'calendar.show';
  if (normalized.includes('görev oluştur') || normalized.includes('yeni görev')) return 'tasks.create';
  if (normalized.includes('geciken') || normalized.includes('geçiken')) return 'tasks.overdue';
  if (normalized.includes('dosya bul') || normalized.includes('ara')) return 'files.search';
  return 'chat';
}

function buildFallbackPlan(input: BuildPlanInput): AssistantActionPlan {
  const mapped = input.quickActionKey ? mapQuickActionToTool(input.quickActionKey) : null;
  const intent = mapped?.toolName ?? inferIntentFromText(input.message);

  const action =
    intent !== 'chat'
      ? [{ toolName: intent, params: mapped?.params ?? (intent === 'files.search' ? { query: input.message } : {}) }]
      : [];

  const needsConfirmation = action.some((item) => item.toolName === 'tasks.create' || item.toolName === 'calendar.extract_tasks');

  return {
    intent,
    reply:
      intent === 'chat'
        ? 'Hazırım. İstersen bu mesajı bir göreve dönüştürebilir veya hızlı aksiyonlardan birini başlatabilirim.'
        : 'İsteğini aldım. Uygun aracı hazırlayıp sonucu hemen getiriyorum.',
    actions: action,
    needsConfirmation,
    suggestions: ['Bugünü özetle', 'Yeni görev oluştur', 'Dosya bul'],
    memoryWrites: [],
  };
}

export async function buildAssistantPlan(input: BuildPlanInput): Promise<{
  plan: AssistantActionPlan;
  preferences: Awaited<ReturnType<typeof getAssistantPreference>>;
}> {
  const preferences = await getAssistantPreference(input.user);
  const deterministic = resolveDeterministicAssistantCommand({
    message: input.message,
    userName: input.user.name,
  });
  if (deterministic && !input.quickActionKey) {
    return {
      plan: deterministic,
      preferences,
    };
  }

  try {
    const systemPrompt = buildAssistantSystemPrompt({
      language: preferences.language,
      tone: preferences.tone,
      assistantName: preferences.assistantName,
      userName: input.user.name,
      memoryEnabled: preferences.memoryEnabled,
      requireConfirmationCritical: preferences.requireConfirmationCritical,
    });

    const routeMeta = [
      input.routeContext?.pathname ? `Aktif rota: ${input.routeContext.pathname}` : null,
      input.routeContext?.section ? `Alan: ${input.routeContext.section}` : null,
      input.routeContext?.focus ? `Odak: ${input.routeContext.focus}` : null,
      input.routeContext?.entityType ? `Varlık tipi: ${input.routeContext.entityType}` : null,
      input.routeContext?.entityId ? `Varlık id: ${input.routeContext.entityId}` : null,
      input.routeContext?.focusType ? `Odak türü: ${input.routeContext.focusType}` : null,
      input.routeContext?.focusId ? `Odak id: ${input.routeContext.focusId}` : null,
      input.routeContext?.relatedEntityIds?.length ? `İlişkili varlıklar: ${input.routeContext.relatedEntityIds.join(', ')}` : null,
      input.routeContext?.queryHints?.length ? `Sorgu ipuçları: ${input.routeContext.queryHints.join(', ')}` : null,
      input.routeContext?.preferredTone ? `Kullanıcı tonu tercihi: ${input.routeContext.preferredTone}` : null,
      input.routeContext?.preferredLength ? `Kullanıcı yanıt uzunluğu tercihi: ${input.routeContext.preferredLength}` : null,
      input.routeContext?.topCommands?.length ? `Sık komutlar: ${input.routeContext.topCommands.join(', ')}` : null,
      input.quickActionKey ? `Hızlı aksiyon: ${input.quickActionKey}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const messageForModel = routeMeta ? `${input.message}\n\nBağlam:\n${routeMeta}` : input.message;

    const modelPlan = await generateAssistantPlan({
      systemPrompt,
      message: messageForModel,
      history: input.history,
    });

    const validated = assistantStructuredOutputSchema.parse(modelPlan);

    return {
      plan: validated,
      preferences,
    };
  } catch (error) {
    console.error('assistant plan model fallback', error);
    return {
      plan: buildFallbackPlan(input),
      preferences,
    };
  }
}

export async function persistMemoryWrites(user: SessionUser, memoryWrites: AssistantActionPlan['memoryWrites']) {
  if (!memoryWrites || memoryWrites.length === 0) {
    return;
  }

  for (const write of memoryWrites) {
    await createMemoryItem(user, {
      kind: write.kind,
      content: write.content,
      tags: write.tags ?? [],
    });
  }
}
