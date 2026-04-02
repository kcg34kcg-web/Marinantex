import {
  AssistantLanguage,
  AssistantTone,
  MemoryKind,
  MessageRole,
  TaskPriority,
  TaskStatus,
  ToolExecutionStatus,
  type Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type {
  AssistantConversationSummary,
  AssistantMessageItem,
  AssistantMemoryItem,
  AssistantPreferencePayload,
  AssistantAuditLogItem,
  AssistantStyleProfile,
} from '@/types/assistant';
import type { SessionUser } from '@/lib/auth/session';
import { buildDefaultPreference } from '@/lib/assistant/defaults';

const memoryFallback = {
  preferences: new Map<string, AssistantPreferencePayload>(),
  styleProfiles: new Map<string, AssistantStyleProfile>(),
  conversations: new Map<string, { id: string; userId: string; title: string; updatedAt: string; isTemporary: boolean }>(),
  messages: new Map<string, AssistantMessageItem[]>(),
  memory: new Map<string, AssistantMemoryItem[]>(),
  tasks: new Map<string, Array<{ id: string; title: string; description: string | null; dueAt: string | null; status: string; priority: string }>>(),
  audit: new Map<string, AssistantAuditLogItem[]>(),
};

const STYLE_PROFILE_MEMORY_KEY = '__assistant_style_profile__';

function mapToneToDb(tone: AssistantPreferencePayload['tone']) {
  if (tone === 'warm') return AssistantTone.WARM;
  if (tone === 'short') return AssistantTone.SHORT;
  if (tone === 'detailed') return AssistantTone.DETAILED;
  return AssistantTone.PROFESSIONAL;
}

function mapToneFromDb(tone: AssistantTone): AssistantPreferencePayload['tone'] {
  if (tone === AssistantTone.WARM) return 'warm';
  if (tone === AssistantTone.SHORT) return 'short';
  if (tone === AssistantTone.DETAILED) return 'detailed';
  return 'professional';
}

function mapLanguageToDb(language: AssistantPreferencePayload['language']) {
  return language === 'en' ? AssistantLanguage.EN : AssistantLanguage.TR;
}

function mapLanguageFromDb(language: AssistantLanguage): AssistantPreferencePayload['language'] {
  return language === AssistantLanguage.EN ? 'en' : 'tr';
}

function normalizeStyleProfile(value: unknown): AssistantStyleProfile {
  const candidate = (value ?? {}) as {
    preferredTone?: AssistantStyleProfile['preferredTone'];
    preferredLength?: AssistantStyleProfile['preferredLength'];
    commandCounters?: Record<string, number>;
  };

  const preferredTone =
    candidate.preferredTone === 'warm' ||
    candidate.preferredTone === 'short' ||
    candidate.preferredTone === 'detailed'
      ? candidate.preferredTone
      : 'professional';

  const preferredLength = candidate.preferredLength === 'detailed' ? 'detailed' : 'short';
  const sourceCounters = candidate.commandCounters && typeof candidate.commandCounters === 'object' ? candidate.commandCounters : {};

  const commandCounters: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(sourceCounters)) {
    if (!key || key.length > 80) {
      continue;
    }
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      continue;
    }
    commandCounters[key] = Math.max(0, Math.min(10000, Math.floor(rawValue)));
  }

  return {
    preferredTone,
    preferredLength,
    commandCounters,
  };
}

async function ensureUserExists(user: SessionUser) {
  await prisma.user.upsert({
    where: { id: user.id },
    update: {
      email: user.email,
      name: user.name,
    },
    create: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  });
}

function isMissingTableError(error: unknown) {
  const code = (error as { code?: string })?.code;
  return code === 'P2021' || code === 'P2022';
}

export async function getAssistantPreference(user: SessionUser): Promise<AssistantPreferencePayload> {
  try {
    await ensureUserExists(user);

    const preference = await prisma.assistantPreference.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        bubbleSize: 80,
      },
    });

    return {
      assistantName: preference.assistantName,
      tone: mapToneFromDb(preference.tone),
      language: mapLanguageFromDb(preference.language),
      responseLength: preference.responseLength === 'detailed' ? 'detailed' : 'short',
      proactiveLevel: preference.proactiveLevel,
      quietHoursStart: preference.quietHoursStart,
      quietHoursEnd: preference.quietHoursEnd,
      keyboardShortcut: preference.keyboardShortcut,
      bubblePositionX: preference.bubblePositionX,
      bubblePositionY: preference.bubblePositionY,
      bubbleSize: preference.bubbleSize,
      animationLevel: preference.animationLevel,
      memoryEnabled: preference.memoryEnabled,
      requireConfirmationCritical: preference.requireConfirmationCritical,
      temporaryMode: preference.temporaryMode,
    };
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('assistant preference load error', error);
    }

    const fallback = memoryFallback.preferences.get(user.id) ?? buildDefaultPreference();
    memoryFallback.preferences.set(user.id, fallback);
    return fallback;
  }
}

export async function updateAssistantPreference(user: SessionUser, payload: AssistantPreferencePayload): Promise<AssistantPreferencePayload> {
  try {
    await ensureUserExists(user);

    const updated = await prisma.assistantPreference.upsert({
      where: { userId: user.id },
      update: {
        assistantName: payload.assistantName,
        tone: mapToneToDb(payload.tone),
        language: mapLanguageToDb(payload.language),
        responseLength: payload.responseLength,
        proactiveLevel: payload.proactiveLevel,
        quietHoursStart: payload.quietHoursStart,
        quietHoursEnd: payload.quietHoursEnd,
        keyboardShortcut: payload.keyboardShortcut,
        bubblePositionX: payload.bubblePositionX,
        bubblePositionY: payload.bubblePositionY,
        bubbleSize: payload.bubbleSize,
        animationLevel: payload.animationLevel,
        memoryEnabled: payload.memoryEnabled,
        requireConfirmationCritical: payload.requireConfirmationCritical,
        temporaryMode: payload.temporaryMode,
      },
      create: {
        userId: user.id,
        assistantName: payload.assistantName,
        tone: mapToneToDb(payload.tone),
        language: mapLanguageToDb(payload.language),
        responseLength: payload.responseLength,
        proactiveLevel: payload.proactiveLevel,
        quietHoursStart: payload.quietHoursStart,
        quietHoursEnd: payload.quietHoursEnd,
        keyboardShortcut: payload.keyboardShortcut,
        bubblePositionX: payload.bubblePositionX,
        bubblePositionY: payload.bubblePositionY,
        bubbleSize: payload.bubbleSize,
        animationLevel: payload.animationLevel,
        memoryEnabled: payload.memoryEnabled,
        requireConfirmationCritical: payload.requireConfirmationCritical,
        temporaryMode: payload.temporaryMode,
      },
    });

    return {
      ...payload,
      assistantName: updated.assistantName,
    };
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('assistant preference update error', error);
    }

    memoryFallback.preferences.set(user.id, payload);
    return payload;
  }
}

export async function getAssistantStyleProfile(user: SessionUser): Promise<AssistantStyleProfile> {
  const fallback = memoryFallback.styleProfiles.get(user.id) ?? normalizeStyleProfile(null);

  try {
    await ensureUserExists(user);
    const row = await prisma.memoryItem.findFirst({
      where: {
        userId: user.id,
        kind: MemoryKind.PREFERENCE,
        content: STYLE_PROFILE_MEMORY_KEY,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!row) {
      memoryFallback.styleProfiles.set(user.id, fallback);
      return fallback;
    }

    const normalized = normalizeStyleProfile(row.metadata);
    memoryFallback.styleProfiles.set(user.id, normalized);
    return normalized;
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('assistant style profile load error', error);
    }
    return fallback;
  }
}

export async function saveAssistantStyleProfile(user: SessionUser, profile: AssistantStyleProfile): Promise<AssistantStyleProfile> {
  const normalized = normalizeStyleProfile(profile);
  memoryFallback.styleProfiles.set(user.id, normalized);

  try {
    await ensureUserExists(user);

    const existing = await prisma.memoryItem.findFirst({
      where: {
        userId: user.id,
        kind: MemoryKind.PREFERENCE,
        content: STYLE_PROFILE_MEMORY_KEY,
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.memoryItem.update({
        where: { id: existing.id },
        data: {
          metadata: normalized as unknown as Prisma.InputJsonValue,
          tags: ['assistant_style_profile'],
        },
      });
      return normalized;
    }

    await prisma.memoryItem.create({
      data: {
        userId: user.id,
        kind: MemoryKind.PREFERENCE,
        content: STYLE_PROFILE_MEMORY_KEY,
        tags: ['assistant_style_profile'],
        metadata: normalized as unknown as Prisma.InputJsonValue,
      },
    });

    return normalized;
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('assistant style profile save error', error);
    }
    return normalized;
  }
}

export async function createConversation(user: SessionUser, title: string, isTemporary: boolean): Promise<AssistantConversationSummary> {
  try {
    await ensureUserExists(user);
    const row = await prisma.conversation.create({
      data: {
        userId: user.id,
        title,
        isTemporary,
      },
    });

    return {
      id: row.id,
      title: row.title,
      isTemporary: row.isTemporary,
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('conversation create error', error);
    }

    const id = crypto.randomUUID();
    const created = {
      id,
      userId: user.id,
      title,
      isTemporary,
      updatedAt: new Date().toISOString(),
    };
    memoryFallback.conversations.set(id, created);
    memoryFallback.messages.set(id, []);
    return {
      id,
      title,
      isTemporary,
      updatedAt: created.updatedAt,
    };
  }
}

export async function getConversationById(user: SessionUser, conversationId: string): Promise<AssistantConversationSummary | null> {
  try {
    const row = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId: user.id,
      },
    });

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      isTemporary: row.isTemporary,
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('conversation detail error', error);
    }

    const item = memoryFallback.conversations.get(conversationId);
    if (!item || item.userId !== user.id) {
      return null;
    }

    return {
      id: item.id,
      title: item.title,
      isTemporary: item.isTemporary,
      updatedAt: item.updatedAt,
    };
  }
}

export async function ensureConversationForUser(
  user: SessionUser,
  input: { conversationId?: string; fallbackTitle: string; isTemporary: boolean },
): Promise<AssistantConversationSummary> {
  if (input.conversationId) {
    const existing = await getConversationById(user, input.conversationId);
    if (existing) {
      return existing;
    }
  }

  return createConversation(user, input.fallbackTitle, input.isTemporary);
}

export async function listConversations(user: SessionUser): Promise<AssistantConversationSummary[]> {
  try {
    const rows = await prisma.conversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 40,
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      isTemporary: row.isTemporary,
      updatedAt: row.updatedAt.toISOString(),
    }));
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('conversation list error', error);
    }

    return [...memoryFallback.conversations.values()]
      .filter((item) => item.userId === user.id)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((item) => ({
        id: item.id,
        title: item.title,
        isTemporary: item.isTemporary,
        updatedAt: item.updatedAt,
      }));
  }
}

export async function getConversationMessages(user: SessionUser, conversationId: string): Promise<AssistantMessageItem[]> {
  try {
    const rows = await prisma.message.findMany({
      where: {
        conversationId,
        conversation: { userId: user.id },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    return rows.map((row) => ({
      id: row.id,
      role: row.role.toLowerCase() as 'user' | 'assistant' | 'system',
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      metadata: (row.metadata as Record<string, unknown> | null | undefined) ?? null,
    }));
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('conversation messages error', error);
    }

    return memoryFallback.messages.get(conversationId) ?? [];
  }
}

export async function appendMessage(input: {
  user: SessionUser;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<AssistantMessageItem> {
  try {
    const role = input.role === 'assistant' ? MessageRole.ASSISTANT : input.role === 'system' ? MessageRole.SYSTEM : MessageRole.USER;
    const row = await prisma.message.create({
      data: {
        conversationId: input.conversationId,
        userId: input.role === 'assistant' ? null : input.user.id,
        role,
        content: input.content,
        metadata: input.metadata,
      },
    });

    await prisma.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: row.createdAt },
    });

    return {
      id: row.id,
      role: input.role,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      metadata: (row.metadata as Record<string, unknown> | null | undefined) ?? null,
    };
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('append message error', error);
    }

    const item: AssistantMessageItem = {
      id: crypto.randomUUID(),
      role: input.role,
      content: input.content,
      createdAt: new Date().toISOString(),
      metadata: (input.metadata as Record<string, unknown> | undefined) ?? null,
    };
    const list = memoryFallback.messages.get(input.conversationId) ?? [];
    list.push(item);
    memoryFallback.messages.set(input.conversationId, list);
    const conv = memoryFallback.conversations.get(input.conversationId);
    if (conv) {
      conv.updatedAt = item.createdAt;
      memoryFallback.conversations.set(input.conversationId, conv);
    }
    return item;
  }
}

export async function listQuickActions() {
  try {
    const rows = await prisma.quickAction.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });

    return rows.map((row) => ({
      key: row.key,
      label: row.label,
      description: row.description,
      prompt: row.prompt,
      icon: row.icon,
      requiresConfirmation: row.requiresConfirmation,
    }));
  } catch {
    return [
      {
        key: 'today_summary',
        label: 'Bugünü özetle',
        description: 'Takvim ve görev özeti çıkarır.',
        prompt: 'Bugünkü takvimimi ve görevlerimi özetle.',
        icon: 'CalendarDays',
        requiresConfirmation: false,
      },
      {
        key: 'mail_summary',
        label: 'Mailleri özetle',
        description: 'Öncelikli e-postaları özetler.',
        prompt: 'Bugünkü mailleri önem sırasına göre özetle.',
        icon: 'Mail',
        requiresConfirmation: false,
      },
      {
        key: 'new_task',
        label: 'Yeni görev oluştur',
        description: 'Yeni görev açar.',
        prompt: 'Yeni görev oluştur.',
        icon: 'Plus',
        requiresConfirmation: true,
      },
    ];
  }
}

export async function listMemoryItems(user: SessionUser): Promise<AssistantMemoryItem[]> {
  try {
    const rows = await prisma.memoryItem.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 120,
    });

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      content: row.content,
      tags: row.tags,
      updatedAt: row.updatedAt.toISOString(),
    }));
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('list memory error', error);
    }

    return memoryFallback.memory.get(user.id) ?? [];
  }
}

export async function createMemoryItem(user: SessionUser, data: { kind: 'NOTE' | 'PREFERENCE' | 'FACT'; content: string; tags: string[] }): Promise<AssistantMemoryItem> {
  try {
    await ensureUserExists(user);

    const row = await prisma.memoryItem.create({
      data: {
        userId: user.id,
        kind: data.kind as MemoryKind,
        content: data.content,
        tags: data.tags,
      },
    });

    return {
      id: row.id,
      kind: row.kind,
      content: row.content,
      tags: row.tags,
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('create memory error', error);
    }

    const item: AssistantMemoryItem = {
      id: crypto.randomUUID(),
      kind: data.kind,
      content: data.content,
      tags: data.tags,
      updatedAt: new Date().toISOString(),
    };
    const list = memoryFallback.memory.get(user.id) ?? [];
    list.unshift(item);
    memoryFallback.memory.set(user.id, list);
    return item;
  }
}

export async function deleteMemoryItem(user: SessionUser, id: string) {
  try {
    await prisma.memoryItem.deleteMany({
      where: { id, userId: user.id },
    });
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('delete memory error', error);
    }

    const list = memoryFallback.memory.get(user.id) ?? [];
    memoryFallback.memory.set(
      user.id,
      list.filter((item) => item.id !== id),
    );
  }
}

export async function createTaskForUser(user: SessionUser, payload: {
  title: string;
  description?: string;
  dueAt?: Date | null;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}) {
  const priority = payload.priority ?? 'MEDIUM';

  try {
    await ensureUserExists(user);

    const row = await prisma.task.create({
      data: {
        userId: user.id,
        title: payload.title,
        description: payload.description,
        dueAt: payload.dueAt,
        priority: priority as TaskPriority,
        status: TaskStatus.TODO,
      },
    });

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      dueAt: row.dueAt?.toISOString() ?? null,
      status: row.status,
      priority: row.priority,
    };
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('create task error', error);
    }

    const item = {
      id: crypto.randomUUID(),
      title: payload.title,
      description: payload.description ?? null,
      dueAt: payload.dueAt?.toISOString() ?? null,
      status: TaskStatus.TODO,
      priority: priority,
    };
    const list = memoryFallback.tasks.get(user.id) ?? [];
    list.unshift(item);
    memoryFallback.tasks.set(user.id, list);
    return item;
  }
}

export async function listTasksForUser(user: SessionUser) {
  try {
    const rows = await prisma.task.findMany({
      where: { userId: user.id },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 120,
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      dueAt: row.dueAt?.toISOString() ?? null,
      status: row.status,
      priority: row.priority,
    }));
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('list tasks error', error);
    }

    return memoryFallback.tasks.get(user.id) ?? [];
  }
}

export async function deleteTasksForUser(user: SessionUser, taskIds: string[]) {
  const uniqueIds = [...new Set(taskIds.filter((id) => typeof id === 'string' && id.length > 0))];
  if (uniqueIds.length === 0) {
    return 0;
  }

  try {
    const result = await prisma.task.deleteMany({
      where: {
        userId: user.id,
        id: { in: uniqueIds },
      },
    });
    return result.count;
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.error('delete tasks error', error);
    }

    const list = memoryFallback.tasks.get(user.id) ?? [];
    const before = list.length;
    const next = list.filter((item) => !uniqueIds.includes(item.id));
    memoryFallback.tasks.set(user.id, next);
    return before - next.length;
  }
}

export async function createToolExecutionLog(input: {
  user: SessionUser;
  conversationId?: string;
  toolName: string;
  params: Prisma.InputJsonValue;
  preview?: Prisma.InputJsonValue;
  requiresConfirmation: boolean;
}) {
  try {
    const row = await prisma.toolExecution.create({
      data: {
        userId: input.user.id,
        conversationId: input.conversationId,
        toolName: input.toolName,
        input: input.params,
        preview: input.preview,
        requiresConfirmation: input.requiresConfirmation,
        status: input.requiresConfirmation ? ToolExecutionStatus.PREVIEW : ToolExecutionStatus.EXECUTED,
      },
    });

    return row.id;
  } catch {
    return crypto.randomUUID();
  }
}

export async function finalizeToolExecution(input: {
  executionId: string;
  userId?: string;
  success: boolean;
  output?: Prisma.InputJsonValue;
  confirmed?: boolean;
}) {
  try {
    if (input.userId) {
      await prisma.toolExecution.updateMany({
        where: {
          id: input.executionId,
          userId: input.userId,
        },
        data: {
          confirmed: input.confirmed ?? false,
          status: input.success ? ToolExecutionStatus.EXECUTED : ToolExecutionStatus.FAILED,
          output: input.output,
          executedAt: new Date(),
        },
      });
      return;
    }

    await prisma.toolExecution.update({
      where: { id: input.executionId },
      data: {
        confirmed: input.confirmed ?? false,
        status: input.success ? ToolExecutionStatus.EXECUTED : ToolExecutionStatus.FAILED,
        output: input.output,
        executedAt: new Date(),
      },
    });
  } catch {
    // fallback no-op
  }
}

export async function writeAuditLog(input: {
  user: SessionUser;
  category: string;
  action: string;
  summary: string;
  entityType?: string;
  entityId?: string;
  details?: Prisma.InputJsonValue;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.user.id,
        category: input.category,
        action: input.action,
        summary: input.summary,
        entityType: input.entityType,
        entityId: input.entityId,
        details: input.details,
      },
    });
  } catch {
    const entry: AssistantAuditLogItem = {
      id: crypto.randomUUID(),
      category: input.category,
      action: input.action,
      summary: input.summary,
      createdAt: new Date().toISOString(),
    };
    const list = memoryFallback.audit.get(input.user.id) ?? [];
    list.unshift(entry);
    memoryFallback.audit.set(input.user.id, list);
  }
}

export async function listAuditLogs(user: SessionUser): Promise<AssistantAuditLogItem[]> {
  try {
    const rows = await prisma.auditLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      action: row.action,
      summary: row.summary,
      createdAt: row.createdAt.toISOString(),
    }));
  } catch {
    return memoryFallback.audit.get(user.id) ?? [];
  }
}
