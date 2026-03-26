import type { SupabaseClient } from '@supabase/supabase-js';

export type TaskReminderSyncKind = 'task_deadline' | 'task_pre_reminder';

const PRE_REMINDER_OFFSETS = [7, 3, 1] as const;

interface TimelineReminderRow {
  id: string;
  metadata: unknown;
}

export interface TaskReminderSyncInput {
  caseId: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string | null;
  dueAt: string | null;
  createdBy: string;
  priority: 'low' | 'normal' | 'high' | null;
  assignedTo: string | null;
  taskType: string | null;
  deadlineType: string | null;
  riskLevel: string | null;
  confidentiality: string | null;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function getString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function reminderKey(kind: TaskReminderSyncKind, offsetDays: number): string {
  return `${kind}:${offsetDays}`;
}

function buildReminderTitle(taskTitle: string, kind: TaskReminderSyncKind, offsetDays: number): string {
  if (kind === 'task_deadline') {
    return `Gorev Son Gunu: ${taskTitle}`;
  }

  return `Gorev Hatirlatma (${offsetDays} gun kaldi): ${taskTitle}`;
}

function buildReminderDescription(
  taskDescription: string | null,
  kind: TaskReminderSyncKind,
  offsetDays: number,
): string | null {
  if (kind === 'task_deadline') {
    return taskDescription ?? null;
  }

  return `Bu kayit gorev takvim senkronu ile olusturuldu. Kalan gun: ${offsetDays}.`;
}

export function getTaskIdFromReminderMetadata(metadata: unknown): string | null {
  const obj = asObject(metadata);
  return getString(obj.taskId);
}

export function getReminderScheduledAt(metadata: unknown): string | null {
  const obj = asObject(metadata);

  const scheduledAt = getString(obj.scheduledAt);
  if (scheduledAt) {
    const parsed = toIsoOrNull(scheduledAt);
    if (parsed) {
      return parsed;
    }
  }

  const dueAt = getString(obj.dueAt);
  if (dueAt) {
    const parsed = toIsoOrNull(dueAt);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

export function getTaskReminderSyncKind(metadata: unknown): TaskReminderSyncKind | null {
  const obj = asObject(metadata);
  const calendarSync = asObject(obj.calendarSync);
  const kind = getString(calendarSync.kind);

  if (kind === 'task_deadline' || kind === 'task_pre_reminder') {
    return kind;
  }

  if (getTaskIdFromReminderMetadata(metadata)) {
    return 'task_deadline';
  }

  return null;
}

export function getTaskReminderOffsetDays(metadata: unknown): number | null {
  const obj = asObject(metadata);
  const calendarSync = asObject(obj.calendarSync);

  const offsetFromSync = getNumber(calendarSync.offsetDays);
  if (offsetFromSync !== null) {
    return offsetFromSync;
  }

  const offsetFromRoot = getNumber(obj.offsetDays) ?? getNumber(obj.reminderOffsetDays);
  if (offsetFromRoot !== null) {
    return offsetFromRoot;
  }

  const kind = getTaskReminderSyncKind(metadata);
  if (kind === 'task_deadline') {
    return 0;
  }

  return null;
}

export function isTaskLinkedReminder(metadata: unknown): boolean {
  return Boolean(getTaskIdFromReminderMetadata(metadata));
}

function buildReminderMetadata(
  input: TaskReminderSyncInput,
  scheduledAt: string,
  kind: TaskReminderSyncKind,
  offsetDays: number,
): Record<string, unknown> {
  const nowIso = new Date().toISOString();

  return {
    taskId: input.taskId,
    dueAt: input.dueAt,
    scheduledAt,
    eventKind: kind === 'task_deadline' ? 'deadline' : 'reminder',
    calendarSync: {
      source: 'office_task',
      kind,
      offsetDays,
      version: 1,
      syncedAt: nowIso,
    },
    taskSnapshot: {
      priority: input.priority,
      assignedTo: input.assignedTo,
      taskType: input.taskType,
      deadlineType: input.deadlineType,
      riskLevel: input.riskLevel,
      confidentiality: input.confidentiality,
    },
  };
}

function desiredReminderDefinitions(dueAtIso: string) {
  return [
    {
      kind: 'task_deadline' as const,
      offsetDays: 0,
      scheduledAt: dueAtIso,
    },
    ...PRE_REMINDER_OFFSETS.map((offsetDays) => ({
      kind: 'task_pre_reminder' as const,
      offsetDays,
      scheduledAt: addDays(dueAtIso, -offsetDays),
    })),
  ];
}

export async function syncTaskReminderTimelineEvents(
  supabase: SupabaseClient,
  input: TaskReminderSyncInput,
): Promise<void> {
  const linkedResult = await supabase
    .from('case_timeline_events')
    .select('id, metadata')
    .eq('case_id', input.caseId)
    .eq('event_type', 'reminder')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (linkedResult.error) {
    throw new Error('task_reminders_fetch_failed');
  }

  const linkedRows = ((linkedResult.data ?? []) as TimelineReminderRow[]).filter(
    (row) => getTaskIdFromReminderMetadata(row.metadata) === input.taskId,
  );

  const dueAtIso = toIsoOrNull(input.dueAt);
  const nowIso = new Date().toISOString();

  if (!dueAtIso) {
    if (linkedRows.length > 0) {
      const ids = linkedRows.map((row) => row.id);
      const removeResult = await supabase
        .from('case_timeline_events')
        .update({ deleted_at: nowIso, updated_at: nowIso })
        .in('id', ids);

      if (removeResult.error) {
        throw new Error('task_reminders_clear_failed');
      }
    }

    return;
  }

  const existingByKey = new Map<string, TimelineReminderRow>();
  const duplicatedIds: string[] = [];

  linkedRows.forEach((row) => {
    const kind = getTaskReminderSyncKind(row.metadata);
    if (!kind) {
      return;
    }

    const offsetDays = getTaskReminderOffsetDays(row.metadata) ?? (kind === 'task_deadline' ? 0 : 0);
    const key = reminderKey(kind, offsetDays);

    if (existingByKey.has(key)) {
      duplicatedIds.push(row.id);
      return;
    }

    existingByKey.set(key, row);
  });

  const desired = desiredReminderDefinitions(dueAtIso);

  for (const reminder of desired) {
    const key = reminderKey(reminder.kind, reminder.offsetDays);
    const existing = existingByKey.get(key);

    const payload = {
      title: buildReminderTitle(input.taskTitle, reminder.kind, reminder.offsetDays),
      description: buildReminderDescription(input.taskDescription, reminder.kind, reminder.offsetDays),
      metadata: buildReminderMetadata(input, reminder.scheduledAt, reminder.kind, reminder.offsetDays),
      updated_at: nowIso,
      deleted_at: null,
    };

    if (existing) {
      const updateResult = await supabase
        .from('case_timeline_events')
        .update(payload)
        .eq('id', existing.id)
        .eq('case_id', input.caseId)
        .is('deleted_at', null);

      if (updateResult.error) {
        throw new Error('task_reminder_update_failed');
      }

      continue;
    }

    const insertResult = await supabase.from('case_timeline_events').insert({
      case_id: input.caseId,
      event_type: 'reminder',
      title: payload.title,
      description: payload.description,
      metadata: payload.metadata,
      created_by: input.createdBy,
    });

    if (insertResult.error) {
      throw new Error('task_reminder_insert_failed');
    }
  }

  const desiredKeys = new Set(desired.map((reminder) => reminderKey(reminder.kind, reminder.offsetDays)));
  const removableIds = [
    ...duplicatedIds,
    ...linkedRows
      .filter((row) => {
        const kind = getTaskReminderSyncKind(row.metadata);
        if (!kind) {
          return true;
        }

        const offsetDays = getTaskReminderOffsetDays(row.metadata) ?? (kind === 'task_deadline' ? 0 : 0);
        return !desiredKeys.has(reminderKey(kind, offsetDays));
      })
      .map((row) => row.id),
  ];

  if (removableIds.length > 0) {
    const removeResult = await supabase
      .from('case_timeline_events')
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .in('id', [...new Set(removableIds)]);

    if (removeResult.error) {
      throw new Error('task_reminder_remove_failed');
    }
  }
}
