import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { canAccessCase } from '@/lib/dashboard/access';
import { logDashboardAudit } from '@/lib/dashboard/audit';
import {
  getReminderScheduledAt,
  getTaskIdFromReminderMetadata,
  getTaskReminderOffsetDays,
  getTaskReminderSyncKind,
  isTaskLinkedReminder,
  syncTaskReminderTimelineEvents,
} from '@/lib/dashboard/calendar-sync';

const TASK_TYPES = [
  'follow_up',
  'petition_drafting',
  'contract_review',
  'precedent_research',
  'hearing_preparation',
  'client_meeting',
  'service_tracking',
  'uyap_control',
] as const;

const DEADLINE_TYPES = ['due_date', 'objection_deadline', 'response_deadline', 'hearing_date', 'service_control'] as const;
const RISK_LEVELS = ['low', 'medium', 'critical'] as const;
const CONFIDENTIALITY_LEVELS = ['team', 'restricted'] as const;
const WORKFLOW_STATUSES = ['planned', 'prepared', 'completed', 'postponed'] as const;

const taskTypeSchema = z.enum(TASK_TYPES);
const deadlineTypeSchema = z.enum(DEADLINE_TYPES);
const riskLevelSchema = z.enum(RISK_LEVELS);
const confidentialitySchema = z.enum(CONFIDENTIALITY_LEVELS);
const workflowStatusSchema = z.enum(WORKFLOW_STATUSES);
const eventKindSchema = z.enum(['hearing', 'service', 'delivery', 'deadline', 'reminder']);

const listQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  caseId: z.string().uuid().optional(),
  q: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => value ?? undefined)
    .refine((value) => value === undefined || value.length > 0, { message: 'q_empty' }),
  assigneeId: z.string().uuid().optional(),
  taskType: taskTypeSchema.optional(),
  deadlineType: deadlineTypeSchema.optional(),
  riskLevel: riskLevelSchema.optional(),
  confidentiality: confidentialitySchema.optional(),
  status: workflowStatusSchema.optional(),
  eventType: eventKindSchema.optional(),
});

const createCalendarEventSchema = z.object({
  caseId: z.string().uuid(),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  eventKind: eventKindSchema.default('reminder'),
  scheduledAt: z.string().datetime(),
  tags: z.array(z.string().trim().min(1).max(30)).max(8).optional(),
  createTask: z.boolean().optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  assignedTo: z.string().uuid().optional(),
  taskType: taskTypeSchema.optional(),
  deadlineType: deadlineTypeSchema.optional(),
  riskLevel: riskLevelSchema.optional(),
  confidentiality: confidentialitySchema.optional(),
});

const updateCalendarItemSchema = z.object({
  source: z.enum(['task_deadline', 'timeline_event']),
  itemId: z.string().min(1),
  caseId: z.string().uuid(),
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  scheduledAt: z.string().datetime().optional(),
  eventKind: eventKindSchema.optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  status: z.enum(['open', 'in_progress', 'done']).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  taskType: taskTypeSchema.optional(),
  deadlineType: deadlineTypeSchema.optional(),
  riskLevel: riskLevelSchema.optional(),
  confidentiality: confidentialitySchema.optional(),
});

const deleteCalendarItemSchema = z.object({
  source: z.enum(['task_deadline', 'timeline_event']),
  itemId: z.string().min(1),
  caseId: z.string().uuid(),
});

type CalendarEventKind = 'hearing' | 'service' | 'delivery' | 'deadline' | 'reminder';
type CalendarItemSource = 'task_deadline' | 'timeline_event' | 'limitation_acceptance';
type CalendarTemporalStatus = 'overdue' | 'today' | 'upcoming';
type CalendarWorkflowStatus = 'planned' | 'prepared' | 'completed' | 'postponed';
type TaskType = (typeof TASK_TYPES)[number];
type DeadlineType = (typeof DEADLINE_TYPES)[number];
type RiskLevel = (typeof RISK_LEVELS)[number];
type ConfidentialityLevel = (typeof CONFIDENTIALITY_LEVELS)[number];

interface CalendarConflictWarning {
  assigneeId: string;
  assigneeName: string | null;
  scheduledAt: string;
  windowMinutes: number;
  conflictCount: number;
  conflicts: Array<{
    source: 'office_task' | 'timeline_event';
    sourceId: string;
    title: string;
    when: string;
    caseId: string;
    caseTitle: string;
  }>;
}

interface CalendarListItem {
  id: string;
  sourceId: string;
  source: CalendarItemSource;
  eventKind: CalendarEventKind;
  temporalStatus: CalendarTemporalStatus;
  when: string;
  title: string;
  description: string | null;
  caseId: string;
  caseTitle: string;
  caseFileNo: string | null;
  priority: 'low' | 'normal' | 'high' | null;
  taskStatus: 'open' | 'in_progress' | 'done' | null;
  assigneeId: string | null;
  assigneeName: string | null;
  taskType: TaskType | null;
  deadlineType: DeadlineType | null;
  riskLevel: RiskLevel | null;
  confidentiality: ConfidentialityLevel | null;
  workflowStatus: CalendarWorkflowStatus;
  linkedTaskId: string | null;
  linkedTimelineEventId: string | null;
  syncKind: 'task_deadline' | 'task_pre_reminder' | null;
  canEdit: boolean;
  canDelete: boolean;
}

interface CalendarAssigneeItem {
  id: string;
  fullName: string | null;
  itemCount: number;
}

interface NormalizedTaskRow {
  id: string;
  case_id: string;
  title: string;
  description: string | null;
  status: 'open' | 'in_progress' | 'done';
  priority: 'low' | 'normal' | 'high';
  due_at: string;
  assigned_to: string | null;
  task_type: TaskType;
  deadline_type: DeadlineType;
  risk_level: RiskLevel;
  confidentiality_level: ConfidentialityLevel;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function isMissingColumnError(error: unknown): boolean {
  return getErrorCode(error) === '42703';
}

function getStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIsoOrNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function toDateOnly(input: Date) {
  return input.toISOString().slice(0, 10);
}

function todayStartEnd() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function toRangeBoundaries(from: string, to: string) {
  const start = new Date(`${from}T00:00:00+03:00`);
  const end = new Date(`${to}T23:59:59.999+03:00`);
  return { start, end };
}

function parseIsoCandidate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const converted = new Date(`${value}T09:00:00+03:00`);
    return Number.isNaN(converted.getTime()) ? null : converted.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getMetadataValue(metadata: unknown, key: string): string | null {
  const obj = asObject(metadata);
  return getStringValue(obj[key]);
}

function extractScheduledAt(metadata: unknown): string | null {
  const taskLinkedScheduled = getReminderScheduledAt(metadata);
  if (taskLinkedScheduled) {
    return taskLinkedScheduled;
  }

  const candidates = [
    getMetadataValue(metadata, 'eventAt'),
    getMetadataValue(metadata, 'eventDate'),
    getMetadataValue(metadata, 'dateTime'),
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    const iso = parseIsoCandidate(candidate);
    if (iso) {
      return iso;
    }
  }

  return null;
}

function extractEventKind(metadata: unknown): CalendarEventKind {
  const raw =
    getMetadataValue(metadata, 'eventKind') ??
    getMetadataValue(metadata, 'calendarType') ??
    getMetadataValue(metadata, 'kind');

  if (!raw) {
    return 'reminder';
  }

  const normalized = raw.toLowerCase();
  if (normalized === 'hearing' || normalized.includes('durusma')) {
    return 'hearing';
  }
  if (normalized === 'service' || normalized.includes('tebligat')) {
    return 'service';
  }
  if (normalized === 'delivery' || normalized.includes('teslim')) {
    return 'delivery';
  }
  if (normalized === 'deadline' || normalized.includes('sure') || normalized.includes('son gun')) {
    return 'deadline';
  }
  return 'reminder';
}

function resolveTemporalStatus(whenIso: string): CalendarTemporalStatus {
  const whenDate = new Date(whenIso);
  if (Number.isNaN(whenDate.getTime())) {
    return 'upcoming';
  }

  const { start, end } = todayStartEnd();
  if (whenDate < start) {
    return 'overdue';
  }
  if (whenDate < end) {
    return 'today';
  }
  return 'upcoming';
}

function withinRange(whenIso: string, from: string, to: string): boolean {
  const whenDate = new Date(whenIso);
  if (Number.isNaN(whenDate.getTime())) {
    return false;
  }

  const { start, end } = toRangeBoundaries(from, to);
  return whenDate >= start && whenDate <= end;
}

function isSameMinute(leftIso: string, rightIso: string): boolean {
  const left = new Date(leftIso);
  const right = new Date(rightIso);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
    return false;
  }

  return Math.abs(left.getTime() - right.getTime()) < 60_000;
}

function normalizeTaskType(value: unknown): TaskType {
  return TASK_TYPES.includes(value as TaskType) ? (value as TaskType) : 'follow_up';
}

function normalizeDeadlineType(value: unknown): DeadlineType {
  return DEADLINE_TYPES.includes(value as DeadlineType) ? (value as DeadlineType) : 'due_date';
}

function normalizeRiskLevel(value: unknown): RiskLevel {
  return RISK_LEVELS.includes(value as RiskLevel) ? (value as RiskLevel) : 'medium';
}

function normalizeConfidentiality(value: unknown): ConfidentialityLevel {
  return CONFIDENTIALITY_LEVELS.includes(value as ConfidentialityLevel) ? (value as ConfidentialityLevel) : 'team';
}

function normalizeTaskStatus(value: unknown): 'open' | 'in_progress' | 'done' {
  if (value === 'open' || value === 'in_progress' || value === 'done') {
    return value;
  }

  return 'open';
}

function normalizePriority(value: unknown): 'low' | 'normal' | 'high' {
  if (value === 'low' || value === 'normal' || value === 'high') {
    return value;
  }

  return 'normal';
}

function taskStatusToWorkflowStatus(status: 'open' | 'in_progress' | 'done'): CalendarWorkflowStatus {
  if (status === 'done') {
    return 'completed';
  }

  if (status === 'in_progress') {
    return 'prepared';
  }

  return 'planned';
}

function normalizeWorkflowStatus(value: unknown): CalendarWorkflowStatus | null {
  if (value === 'planned' || value === 'prepared' || value === 'completed' || value === 'postponed') {
    return value;
  }

  if (value === 'open') {
    return 'planned';
  }
  if (value === 'in_progress') {
    return 'prepared';
  }
  if (value === 'done') {
    return 'completed';
  }

  return null;
}

function extractWorkflowStatus(metadata: unknown, temporalStatus: CalendarTemporalStatus): CalendarWorkflowStatus {
  const fromMetadata = normalizeWorkflowStatus(
    getMetadataValue(metadata, 'workflowStatus') ?? getMetadataValue(metadata, 'status'),
  );

  if (fromMetadata) {
    return fromMetadata;
  }

  if (temporalStatus === 'overdue') {
    return 'postponed';
  }

  return 'planned';
}

function includesQueryText(value: string | null, query: string): boolean {
  if (!value) {
    return false;
  }

  return value.toLocaleLowerCase('tr').includes(query);
}

function itemMatchesSearch(item: CalendarListItem, query: string | undefined): boolean {
  if (!query) {
    return true;
  }

  return (
    includesQueryText(item.title, query) ||
    includesQueryText(item.description, query) ||
    includesQueryText(item.caseTitle, query) ||
    includesQueryText(item.caseFileNo, query) ||
    includesQueryText(item.assigneeName, query)
  );
}

function getAssigneeIdFromMetadata(metadata: unknown): string | null {
  const direct =
    getMetadataValue(metadata, 'assignedTo') ??
    getMetadataValue(metadata, 'assigneeId') ??
    getMetadataValue(metadata, 'responsibleUserId');

  if (direct) {
    return direct;
  }

  const snapshot = asObject(asObject(metadata).taskSnapshot);
  return getStringValue(snapshot.assignedTo);
}

function normalizeTaskRow(row: Record<string, unknown>): NormalizedTaskRow | null {
  const id = getStringValue(row.id);
  const caseId = getStringValue(row.case_id);
  const title = getStringValue(row.title);
  const dueAt = parseIsoOrNull(getStringValue(row.due_at));

  if (!id || !caseId || !title || !dueAt) {
    return null;
  }

  return {
    id,
    case_id: caseId,
    title,
    description: getStringValue(row.description),
    status: normalizeTaskStatus(getStringValue(row.status)),
    priority: normalizePriority(getStringValue(row.priority)),
    due_at: dueAt,
    assigned_to: getStringValue(row.assigned_to),
    task_type: normalizeTaskType(getStringValue(row.task_type)),
    deadline_type: normalizeDeadlineType(getStringValue(row.deadline_type)),
    risk_level: normalizeRiskLevel(getStringValue(row.risk_level)),
    confidentiality_level: normalizeConfidentiality(getStringValue(row.confidentiality_level)),
  };
}

async function fetchCaseTasks(
  admin: ReturnType<typeof createAdminClient>,
  caseIds: string[],
  from: string,
  to: string,
  includeDone: boolean,
): Promise<NormalizedTaskRow[]> {
  const rangeStart = `${from}T00:00:00+03:00`;
  const rangeEnd = `${to}T23:59:59.999+03:00`;
  const statuses = includeDone ? (['open', 'in_progress', 'done'] as const) : (['open', 'in_progress'] as const);

  const extendedResult = await admin
    .from('office_tasks')
    .select(
      'id, case_id, title, description, status, priority, due_at, assigned_to, task_type, deadline_type, risk_level, confidentiality_level',
    )
    .in('case_id', caseIds)
    .not('due_at', 'is', null)
    .in('status', statuses)
    .gte('due_at', rangeStart)
    .lte('due_at', rangeEnd)
    .order('due_at', { ascending: true })
    .limit(1500);

  if (!extendedResult.error) {
    return (extendedResult.data ?? [])
      .map((row) => normalizeTaskRow(row as Record<string, unknown>))
      .filter((item): item is NormalizedTaskRow => Boolean(item));
  }

  const errorCode = getErrorCode(extendedResult.error);
  if (errorCode === '42P01') {
    return [];
  }

  if (errorCode !== '42703') {
    throw new Error('tasks_fetch_failed');
  }

  const legacyResult = await admin
    .from('office_tasks')
    .select('id, case_id, title, description, status, priority, due_at, assigned_to')
    .in('case_id', caseIds)
    .not('due_at', 'is', null)
    .in('status', statuses)
    .gte('due_at', rangeStart)
    .lte('due_at', rangeEnd)
    .order('due_at', { ascending: true })
    .limit(1500);

  if (legacyResult.error) {
    if (getErrorCode(legacyResult.error) === '42P01') {
      return [];
    }

    throw new Error('tasks_fetch_failed');
  }

  return (legacyResult.data ?? [])
    .map((row) =>
      normalizeTaskRow({
        ...row,
        task_type: 'follow_up',
        deadline_type: 'due_date',
        risk_level: 'medium',
        confidentiality_level: 'team',
      } as Record<string, unknown>),
    )
    .filter((item): item is NormalizedTaskRow => Boolean(item));
}

function taskMatchesFilters(
  task: NormalizedTaskRow,
  filters: {
    taskType?: TaskType;
    deadlineType?: DeadlineType;
    riskLevel?: RiskLevel;
    confidentiality?: ConfidentialityLevel;
  },
): boolean {
  if (filters.taskType && task.task_type !== filters.taskType) {
    return false;
  }

  if (filters.deadlineType && task.deadline_type !== filters.deadlineType) {
    return false;
  }

  if (filters.riskLevel && task.risk_level !== filters.riskLevel) {
    return false;
  }

  if (filters.confidentiality && task.confidentiality_level !== filters.confidentiality) {
    return false;
  }

  return true;
}

function hasTaskScopedFilters(filters: {
  taskType?: TaskType;
  deadlineType?: DeadlineType;
  riskLevel?: RiskLevel;
  confidentiality?: ConfidentialityLevel;
}): boolean {
  return Boolean(filters.taskType || filters.deadlineType || filters.riskLevel || filters.confidentiality);
}

function toIstanbulDateOnly(whenIso: string): string | null {
  const date = new Date(whenIso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

async function fetchAccessibleCasesForConflict(
  admin: ReturnType<typeof createAdminClient>,
  access: { role: string; userId: string },
): Promise<Array<{ id: string; title: string }>> {
  let casesQuery = admin.from('cases').select('id, title').order('updated_at', { ascending: false }).limit(1200);

  if (access.role === 'lawyer') {
    casesQuery = casesQuery.eq('lawyer_id', access.userId);
  }

  const result = await casesQuery;
  if (result.error) {
    throw new Error('conflict_cases_fetch_failed');
  }

  return (result.data ?? []).map((item) => ({
    id: item.id,
    title: item.title,
  }));
}

function toPositiveMinuteDistance(leftIso: string, rightIso: string): number {
  const left = new Date(leftIso);
  const right = new Date(rightIso);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(left.getTime() - right.getTime()) / 60_000;
}

async function detectCalendarConflicts(
  admin: ReturnType<typeof createAdminClient>,
  access: { role: string; userId: string },
  options: {
    assigneeId: string | null;
    scheduledAt: string | null;
    excludeTaskId?: string;
    excludeTimelineEventId?: string;
  },
): Promise<CalendarConflictWarning | null> {
  if (!options.assigneeId || !options.scheduledAt) {
    return null;
  }

  const scheduledAtIso = parseIsoOrNull(options.scheduledAt);
  if (!scheduledAtIso) {
    return null;
  }

  const istanbulDate = toIstanbulDateOnly(scheduledAtIso);
  if (!istanbulDate) {
    return null;
  }

  const accessibleCases = await fetchAccessibleCasesForConflict(admin, access);
  if (accessibleCases.length === 0) {
    return null;
  }

  const caseIds = accessibleCases.map((item) => item.id);
  const caseTitleById = new Map(accessibleCases.map((item) => [item.id, item.title]));
  const { start, end } = toRangeBoundaries(istanbulDate, istanbulDate);
  const rangeStart = start.toISOString();
  const rangeEnd = end.toISOString();

  const extendedTaskResult = await admin
    .from('office_tasks')
    .select('id, case_id, title, due_at, status')
    .in('case_id', caseIds)
    .eq('assigned_to', options.assigneeId)
    .not('due_at', 'is', null)
    .in('status', ['open', 'in_progress'])
    .gte('due_at', rangeStart)
    .lte('due_at', rangeEnd)
    .limit(1200);

  const taskResult =
    extendedTaskResult.error && isMissingColumnError(extendedTaskResult.error)
      ? await admin
          .from('office_tasks')
          .select('id, case_id, title, due_at')
          .in('case_id', caseIds)
          .eq('assigned_to', options.assigneeId)
          .not('due_at', 'is', null)
          .gte('due_at', rangeStart)
          .lte('due_at', rangeEnd)
          .limit(1200)
      : extendedTaskResult;

  if (taskResult.error) {
    if (getErrorCode(taskResult.error) !== '42P01') {
      throw new Error('conflict_tasks_fetch_failed');
    }
  }

  const taskCandidates = (taskResult.data ?? [])
    .map((row) => {
      const id = getStringValue((row as Record<string, unknown>).id);
      const caseId = getStringValue((row as Record<string, unknown>).case_id);
      const title = getStringValue((row as Record<string, unknown>).title);
      const dueAt = parseIsoOrNull(getStringValue((row as Record<string, unknown>).due_at));

      if (!id || !caseId || !title || !dueAt) {
        return null;
      }

      if (options.excludeTaskId && options.excludeTaskId === id) {
        return null;
      }

      return {
        source: 'office_task' as const,
        sourceId: id,
        caseId,
        caseTitle: caseTitleById.get(caseId) ?? 'Dosya',
        title,
        when: dueAt,
      };
    })
    .filter(
      (
        candidate,
      ): candidate is {
        source: 'office_task';
        sourceId: string;
        caseId: string;
        caseTitle: string;
        title: string;
        when: string;
      } => Boolean(candidate),
    );

  const taskIdSet = new Set(taskCandidates.map((candidate) => candidate.sourceId));

  const timelineResult = await admin
    .from('case_timeline_events')
    .select('id, case_id, title, metadata, created_at')
    .in('case_id', caseIds)
    .eq('event_type', 'reminder')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(2500);

  if (timelineResult.error) {
    if (getErrorCode(timelineResult.error) !== '42P01') {
      throw new Error('conflict_timeline_fetch_failed');
    }
  }

  const timelineCandidates = (timelineResult.data ?? [])
    .map((row) => {
      if (options.excludeTimelineEventId && row.id === options.excludeTimelineEventId) {
        return null;
      }

      const scheduledAt = extractScheduledAt(row.metadata);
      if (!scheduledAt || !withinRange(scheduledAt, istanbulDate, istanbulDate)) {
        return null;
      }

      const linkedTaskId = getTaskIdFromReminderMetadata(row.metadata);
      if (linkedTaskId && options.excludeTaskId && linkedTaskId === options.excludeTaskId) {
        return null;
      }

      const metadataAssigneeId = getAssigneeIdFromMetadata(row.metadata);
      const matchesAssignee =
        (linkedTaskId && taskIdSet.has(linkedTaskId)) || (metadataAssigneeId !== null && metadataAssigneeId === options.assigneeId);

      if (!matchesAssignee) {
        return null;
      }

      const caseTitle = caseTitleById.get(row.case_id) ?? 'Dosya';
      return {
        source: 'timeline_event' as const,
        sourceId: row.id,
        caseId: row.case_id,
        caseTitle,
        title: row.title,
        when: scheduledAt,
      };
    })
    .filter(
      (
        candidate,
      ): candidate is {
        source: 'timeline_event';
        sourceId: string;
        caseId: string;
        caseTitle: string;
        title: string;
        when: string;
      } => Boolean(candidate),
    );

  const allCandidates = [...taskCandidates, ...timelineCandidates];
  if (allCandidates.length === 0) {
    return null;
  }

  const conflictWindowMinutes = 60;
  const nearbyCandidates = allCandidates
    .filter((candidate) => toPositiveMinuteDistance(candidate.when, scheduledAtIso) <= conflictWindowMinutes)
    .sort((left, right) => {
      const leftDistance = toPositiveMinuteDistance(left.when, scheduledAtIso);
      const rightDistance = toPositiveMinuteDistance(right.when, scheduledAtIso);

      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      return left.when.localeCompare(right.when);
    });

  if (nearbyCandidates.length === 0) {
    return null;
  }

  let assigneeName: string | null = null;
  const assigneeResult = await admin.from('profiles').select('full_name').eq('id', options.assigneeId).maybeSingle();
  if (!assigneeResult.error) {
    assigneeName = assigneeResult.data?.full_name ?? null;
  }

  return {
    assigneeId: options.assigneeId,
    assigneeName,
    scheduledAt: scheduledAtIso,
    windowMinutes: conflictWindowMinutes,
    conflictCount: nearbyCandidates.length,
    conflicts: nearbyCandidates.slice(0, 6).map((candidate) => ({
      source: candidate.source,
      sourceId: candidate.sourceId,
      title: candidate.title,
      when: candidate.when,
      caseId: candidate.caseId,
      caseTitle: candidate.caseTitle,
    })),
  };
}

export async function GET(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const today = toDateOnly(new Date());
  const nextThirtyDays = toDateOnly(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

  const searchParams = new URL(request.url).searchParams;
  const parsed = listQuerySchema.safeParse({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    caseId: searchParams.get('caseId') ?? undefined,
    q: searchParams.get('q') ?? undefined,
    assigneeId: searchParams.get('assigneeId') ?? undefined,
    taskType: searchParams.get('taskType') ?? undefined,
    deadlineType: searchParams.get('deadlineType') ?? undefined,
    riskLevel: searchParams.get('riskLevel') ?? undefined,
    confidentiality: searchParams.get('confidentiality') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    eventType: searchParams.get('eventType') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: 'Gecersiz takvim sorgusu.' }, { status: 400 });
  }

  const from = parsed.data.from ?? today;
  const to = parsed.data.to ?? nextThirtyDays;
  const requestedCaseId = parsed.data.caseId;
  const queryText = parsed.data.q?.toLocaleLowerCase('tr');
  const requestedAssigneeId = parsed.data.assigneeId;
  const requestedStatus = parsed.data.status;
  const requestedEventType = parsed.data.eventType;

  if (from > to) {
    return Response.json({ error: 'Tarih araligi gecersiz.' }, { status: 400 });
  }

  const taskFilters = {
    taskType: parsed.data.taskType,
    deadlineType: parsed.data.deadlineType,
    riskLevel: parsed.data.riskLevel,
    confidentiality: parsed.data.confidentiality,
  };

  const admin = createAdminClient();

  let casesQuery = admin
    .from('cases')
    .select('id, title, file_no, status, lawyer_id')
    .order('updated_at', { ascending: false })
    .limit(500);

  if (access.role === 'lawyer') {
    casesQuery = casesQuery.eq('lawyer_id', access.userId);
  }

  const casesResult = await casesQuery;
  if (casesResult.error) {
    return Response.json({ error: 'Takvim dosyalari alinamadi.' }, { status: 500 });
  }

  const availableCases = (casesResult.data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    fileNo: row.file_no,
    status: row.status,
  }));

  const caseMap = new Map(
    availableCases.map((item) => [
      item.id,
      {
        title: item.title,
        fileNo: item.fileNo as string | null,
      },
    ]),
  );

  if (requestedCaseId && !caseMap.has(requestedCaseId)) {
    return Response.json({ error: 'Bu dosya takvimine erisim yetkiniz yok.' }, { status: 403 });
  }

  const caseIds = requestedCaseId ? [requestedCaseId] : availableCases.map((item) => item.id);
  if (caseIds.length === 0) {
    return Response.json({
      range: { from, to },
      summary: { total: 0, overdue: 0, today: 0, upcoming: 0 },
      cases: availableCases,
      assignees: [] as CalendarAssigneeItem[],
      items: [] as CalendarListItem[],
    });
  }

  let taskRows: NormalizedTaskRow[] = [];
  try {
    taskRows = await fetchCaseTasks(admin, caseIds, from, to, requestedStatus === 'completed');
  } catch {
    return Response.json({ error: 'Takvim gorev verisi alinamadi.' }, { status: 500 });
  }

  const [timelineResult, limitationResult] = await Promise.all([
    admin
      .from('case_timeline_events')
      .select('id, case_id, title, description, metadata, created_at, created_by')
      .in('case_id', caseIds)
      .eq('event_type', 'reminder')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(2000),
    admin
      .from('limitation_acceptances')
      .select('id, case_id, estimated_date, accepted_at')
      .in('case_id', caseIds)
      .gte('estimated_date', from)
      .lte('estimated_date', to)
      .order('estimated_date', { ascending: true })
      .limit(500),
  ]);

  if (timelineResult.error && getErrorCode(timelineResult.error) !== '42P01') {
    return Response.json({ error: 'Takvim event verisi alinamadi.' }, { status: 500 });
  }
  if (limitationResult.error && getErrorCode(limitationResult.error) !== '42P01') {
    return Response.json({ error: 'Sure kabul verisi alinamadi.' }, { status: 500 });
  }

  const filteredTasks = taskRows.filter((task) => taskMatchesFilters(task, taskFilters));
  const assigneeCounter = new Map<string, number>();

  filteredTasks.forEach((task) => {
    if (!task.assigned_to) {
      return;
    }

    assigneeCounter.set(task.assigned_to, (assigneeCounter.get(task.assigned_to) ?? 0) + 1);
  });

  let visibleTasks = filteredTasks;
  if (requestedAssigneeId) {
    visibleTasks = visibleTasks.filter((task) => task.assigned_to === requestedAssigneeId);
  }

  const visibleTaskMap = new Map(visibleTasks.map((task) => [task.id, task]));

  const assigneeIdsToFetch = [...new Set([...assigneeCounter.keys(), requestedAssigneeId].filter((id): id is string => Boolean(id)))];

  let assigneeNameById = new Map<string, string | null>();
  if (assigneeIdsToFetch.length > 0) {
    const assigneeResult = await admin.from('profiles').select('id, full_name').in('id', assigneeIdsToFetch);

    if (assigneeResult.error) {
      return Response.json({ error: 'Sorumlu bilgileri alinamadi.' }, { status: 500 });
    }

    assigneeNameById = new Map((assigneeResult.data ?? []).map((item) => [item.id, item.full_name]));
  }

  const assignees: CalendarAssigneeItem[] = [...assigneeCounter.entries()]
    .map(([id, itemCount]) => ({
      id,
      fullName: assigneeNameById.get(id) ?? null,
      itemCount,
    }))
    .sort((left, right) => right.itemCount - left.itemCount || (left.fullName ?? '').localeCompare(right.fullName ?? ''));

  if (requestedAssigneeId && !assignees.some((item) => item.id === requestedAssigneeId)) {
    assignees.unshift({
      id: requestedAssigneeId,
      fullName: assigneeNameById.get(requestedAssigneeId) ?? null,
      itemCount: 0,
    });
  }

  const items: CalendarListItem[] = [];
  const deadlineReminderByTaskId = new Map<string, string>();
  const withTaskFilters = hasTaskScopedFilters(taskFilters);

  (timelineResult.data ?? []).forEach((row) => {
    const relatedCase = caseMap.get(row.case_id);
    if (!relatedCase) {
      return;
    }

    const scheduledAt = extractScheduledAt(row.metadata);
    if (!scheduledAt || !withinRange(scheduledAt, from, to)) {
      return;
    }

    const linkedTaskId = getTaskIdFromReminderMetadata(row.metadata);
    const linkedTask = linkedTaskId ? visibleTaskMap.get(linkedTaskId) ?? null : null;
    const syncKind = getTaskReminderSyncKind(row.metadata);
    const syncOffset = getTaskReminderOffsetDays(row.metadata);

    if (linkedTaskId && !linkedTask) {
      return;
    }

    if (linkedTask) {
      const shouldMergeWithTask =
        syncKind === 'task_deadline' || (!syncKind && linkedTask.due_at ? isSameMinute(scheduledAt, linkedTask.due_at) : false);

      if (shouldMergeWithTask) {
        deadlineReminderByTaskId.set(linkedTask.id, row.id);
        return;
      }
    } else {
      if (requestedAssigneeId || withTaskFilters) {
        return;
      }
    }

    const isTaskLinked = isTaskLinkedReminder(row.metadata);

    const temporalStatus = resolveTemporalStatus(scheduledAt);
    const workflowStatus = linkedTask ? taskStatusToWorkflowStatus(linkedTask.status) : extractWorkflowStatus(row.metadata, temporalStatus);

    items.push({
      id: `timeline-${row.id}`,
      sourceId: row.id,
      source: 'timeline_event',
      eventKind: extractEventKind(row.metadata),
      temporalStatus,
      when: scheduledAt,
      title: row.title,
      description: row.description,
      caseId: row.case_id,
      caseTitle: relatedCase.title,
      caseFileNo: relatedCase.fileNo,
      priority: linkedTask?.priority ?? null,
      taskStatus: linkedTask?.status ?? null,
      assigneeId: linkedTask?.assigned_to ?? null,
      assigneeName: linkedTask?.assigned_to ? assigneeNameById.get(linkedTask.assigned_to) ?? null : null,
      taskType: linkedTask?.task_type ?? null,
      deadlineType: linkedTask?.deadline_type ?? null,
      riskLevel: linkedTask?.risk_level ?? null,
      confidentiality: linkedTask?.confidentiality_level ?? null,
      workflowStatus,
      linkedTaskId: linkedTask?.id ?? null,
      linkedTimelineEventId: null,
      syncKind:
        syncKind === 'task_pre_reminder'
          ? 'task_pre_reminder'
          : syncKind === 'task_deadline'
            ? 'task_deadline'
            : syncOffset && syncOffset > 0
              ? 'task_pre_reminder'
              : null,
      canEdit: !isTaskLinked,
      canDelete: !isTaskLinked,
    });
  });

  visibleTasks.forEach((task) => {
    const relatedCase = caseMap.get(task.case_id);
    if (!relatedCase) {
      return;
    }

    items.push({
      id: `task-${task.id}`,
      sourceId: task.id,
      source: 'task_deadline',
      eventKind: 'deadline',
      temporalStatus: resolveTemporalStatus(task.due_at),
      when: task.due_at,
      title: task.title,
      description: task.description,
      caseId: task.case_id,
      caseTitle: relatedCase.title,
      caseFileNo: relatedCase.fileNo,
      priority: task.priority,
      taskStatus: task.status,
      assigneeId: task.assigned_to,
      assigneeName: task.assigned_to ? assigneeNameById.get(task.assigned_to) ?? null : null,
      taskType: task.task_type,
      deadlineType: task.deadline_type,
      riskLevel: task.risk_level,
      confidentiality: task.confidentiality_level,
      workflowStatus: taskStatusToWorkflowStatus(task.status),
      linkedTaskId: task.id,
      linkedTimelineEventId: deadlineReminderByTaskId.get(task.id) ?? null,
      syncKind: 'task_deadline',
      canEdit: true,
      canDelete: true,
    });
  });

  (limitationResult.data ?? []).forEach((row) => {
    if (requestedAssigneeId || withTaskFilters) {
      return;
    }

    const relatedCase = caseMap.get(row.case_id);
    if (!relatedCase) {
      return;
    }

    const when = `${row.estimated_date}T17:00:00+03:00`;
    const whenIso = new Date(when).toISOString();
    if (!withinRange(whenIso, from, to)) {
      return;
    }

    items.push({
      id: `limitation-${row.id}`,
      sourceId: row.id,
      source: 'limitation_acceptance',
      eventKind: 'deadline',
      temporalStatus: resolveTemporalStatus(whenIso),
      when: whenIso,
      title: 'Onayli sure kaydi',
      description: `Kabul tarihi: ${row.accepted_at}`,
      caseId: row.case_id,
      caseTitle: relatedCase.title,
      caseFileNo: relatedCase.fileNo,
      priority: null,
      taskStatus: null,
      assigneeId: null,
      assigneeName: null,
      taskType: null,
      deadlineType: null,
      riskLevel: null,
      confidentiality: null,
      workflowStatus: 'completed',
      linkedTaskId: null,
      linkedTimelineEventId: null,
      syncKind: null,
      canEdit: false,
      canDelete: false,
    });
  });

  items.sort((left, right) => left.when.localeCompare(right.when));
  const filteredItems = items.filter((item) => {
    if (requestedEventType && item.eventKind !== requestedEventType) {
      return false;
    }

    if (requestedStatus && item.workflowStatus !== requestedStatus) {
      return false;
    }

    if (!itemMatchesSearch(item, queryText)) {
      return false;
    }

    return true;
  });

  return Response.json({
    range: { from, to },
    summary: {
      total: filteredItems.length,
      overdue: filteredItems.filter((item) => item.temporalStatus === 'overdue').length,
      today: filteredItems.filter((item) => item.temporalStatus === 'today').length,
      upcoming: filteredItems.filter((item) => item.temporalStatus === 'upcoming').length,
    },
    cases: availableCases,
    assignees,
    items: filteredItems,
  });
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = createCalendarEventSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Gecersiz takvim event verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId: payload.caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyada takvim event olusturma yetkiniz yok.' }, { status: 403 });
  }

  if (payload.createTask) {
    const assigneeId = payload.assignedTo ?? access.userId;
    let conflictWarning: CalendarConflictWarning | null = null;
    try {
      conflictWarning = await detectCalendarConflicts(admin, access, {
        assigneeId,
        scheduledAt: payload.scheduledAt,
      });
    } catch (conflictError) {
      console.error('calendar_conflict_detection_failed', conflictError);
    }

    const nowIso = new Date().toISOString();

    const extendedTaskInsertResult = await admin
      .from('office_tasks')
      .insert({
        case_id: payload.caseId,
        source_message_id: null,
        thread_id: null,
        title: payload.title,
        description: payload.description ?? null,
        priority: payload.priority ?? 'normal',
        assigned_to: payload.assignedTo ?? access.userId,
        created_by: access.userId,
        due_at: payload.scheduledAt,
        status: 'open',
        task_type: payload.taskType ?? 'follow_up',
        deadline_type: payload.deadlineType ?? 'due_date',
        risk_level: payload.riskLevel ?? 'medium',
        confidentiality_level: payload.confidentiality ?? 'team',
        updated_at: nowIso,
      })
      .select('id, case_id, title, description, due_at, priority, assigned_to, task_type, deadline_type, risk_level, confidentiality_level')
      .single();

    const taskInsertResult =
      extendedTaskInsertResult.error && isMissingColumnError(extendedTaskInsertResult.error)
        ? await admin
            .from('office_tasks')
            .insert({
              case_id: payload.caseId,
              source_message_id: null,
              thread_id: null,
              title: payload.title,
              description: payload.description ?? null,
              priority: payload.priority ?? 'normal',
              assigned_to: payload.assignedTo ?? access.userId,
              created_by: access.userId,
              due_at: payload.scheduledAt,
              status: 'open',
              updated_at: nowIso,
            })
            .select('id, case_id, title, description, due_at, priority, assigned_to')
            .single()
        : extendedTaskInsertResult;

    if (taskInsertResult.error || !taskInsertResult.data) {
      return Response.json({ error: 'Takvimden gorev olusturulamadi.' }, { status: 500 });
    }

    const taskRow = taskInsertResult.data as {
      id: string;
      case_id: string;
      title: string;
      description: string | null;
      due_at: string | null;
      priority: 'low' | 'normal' | 'high';
      assigned_to: string | null;
      task_type?: string | null;
      deadline_type?: string | null;
      risk_level?: string | null;
      confidentiality_level?: string | null;
    };

    try {
      await syncTaskReminderTimelineEvents(admin, {
        caseId: payload.caseId,
        taskId: taskRow.id,
        taskTitle: taskRow.title,
        taskDescription: taskRow.description,
        dueAt: taskRow.due_at,
        createdBy: access.userId,
        priority: taskRow.priority,
        assignedTo: taskRow.assigned_to,
        taskType: taskRow.task_type ?? 'follow_up',
        deadlineType: taskRow.deadline_type ?? 'due_date',
        riskLevel: taskRow.risk_level ?? 'medium',
        confidentiality: taskRow.confidentiality_level ?? 'team',
      });
    } catch (syncError) {
      console.error('calendar_create_task_sync_failed', syncError);
    }

    await admin.from('case_timeline_events').insert({
      case_id: payload.caseId,
      event_type: 'user_action',
      title: 'Takvimden gorev olusturuldu',
      description: payload.title,
      metadata: {
        taskId: taskRow.id,
        calendarSync: {
          source: 'office_task',
          createdFrom: 'calendar',
        },
      },
      created_by: access.userId,
    });

    await logDashboardAudit(admin, {
      actorUserId: access.userId,
      action: 'calendar_task_created',
      entityType: 'office_task',
      entityId: taskRow.id,
      metadata: {
        caseId: payload.caseId,
        scheduledAt: payload.scheduledAt,
      },
    });

    return Response.json({
      task: {
        id: taskRow.id,
        caseId: taskRow.case_id,
        title: taskRow.title,
        dueAt: taskRow.due_at,
      },
      conflictWarning,
    });
  }

  const insertResult = await admin
    .from('case_timeline_events')
    .insert({
      case_id: payload.caseId,
      event_type: 'reminder',
      title: payload.title,
      description: payload.description ?? null,
      metadata: {
        scheduledAt: payload.scheduledAt,
        eventKind: payload.eventKind,
        tags: payload.tags ?? [],
        calendarSync: {
          source: 'calendar_manual',
        },
      },
      created_by: access.userId,
    })
    .select('id, case_id, title, description, metadata, created_at')
    .single();

  if (insertResult.error || !insertResult.data) {
    return Response.json({ error: 'Takvim event kaydedilemedi.' }, { status: 500 });
  }

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'calendar_event_created',
    entityType: 'case_timeline_event',
    entityId: insertResult.data.id,
    metadata: {
      caseId: payload.caseId,
      eventKind: payload.eventKind,
      scheduledAt: payload.scheduledAt,
    },
  });

  return Response.json({
    event: {
      id: insertResult.data.id,
      caseId: insertResult.data.case_id,
      title: insertResult.data.title,
      description: insertResult.data.description,
      metadata: insertResult.data.metadata,
      createdAt: insertResult.data.created_at,
    },
  });
}

export async function PATCH(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = updateCalendarItemSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Gecersiz takvim guncelleme verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId: payload.caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyada takvim duzenleme yetkiniz yok.' }, { status: 403 });
  }

  if (payload.source === 'task_deadline') {
    const existingTask = await admin
      .from('office_tasks')
      .select(
        'id, case_id, title, description, due_at, priority, status, assigned_to, task_type, deadline_type, risk_level, confidentiality_level',
      )
      .eq('id', payload.itemId)
      .eq('case_id', payload.caseId)
      .maybeSingle();

    if (existingTask.error) {
      return Response.json({ error: 'Gorev kaydi alinamadi.' }, { status: 500 });
    }

    if (!existingTask.data) {
      return Response.json({ error: 'Gorev kaydi bulunamadi.' }, { status: 404 });
    }

    const conflictAssigneeId = payload.assignedTo === undefined ? existingTask.data.assigned_to : payload.assignedTo;
    const conflictScheduledAt = payload.scheduledAt ?? existingTask.data.due_at;
    let conflictWarning: CalendarConflictWarning | null = null;
    try {
      conflictWarning = await detectCalendarConflicts(admin, access, {
        assigneeId: conflictAssigneeId,
        scheduledAt: conflictScheduledAt,
        excludeTaskId: payload.itemId,
      });
    } catch (conflictError) {
      console.error('calendar_task_conflict_detection_failed', conflictError);
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (payload.title !== undefined) {
      updatePayload.title = payload.title;
    }
    if (payload.description !== undefined) {
      updatePayload.description = payload.description;
    }
    if (payload.scheduledAt !== undefined) {
      updatePayload.due_at = payload.scheduledAt;
    }
    if (payload.priority !== undefined) {
      updatePayload.priority = payload.priority;
    }
    if (payload.status !== undefined) {
      updatePayload.status = payload.status;
    }
    if (payload.assignedTo !== undefined) {
      updatePayload.assigned_to = payload.assignedTo;
    }
    if (payload.taskType !== undefined) {
      updatePayload.task_type = payload.taskType;
    }
    if (payload.deadlineType !== undefined) {
      updatePayload.deadline_type = payload.deadlineType;
    }
    if (payload.riskLevel !== undefined) {
      updatePayload.risk_level = payload.riskLevel;
    }
    if (payload.confidentiality !== undefined) {
      updatePayload.confidentiality_level = payload.confidentiality;
    }

    const extendedUpdateResult = await admin
      .from('office_tasks')
      .update(updatePayload)
      .eq('id', payload.itemId)
      .eq('case_id', payload.caseId)
      .select(
        'id, case_id, title, description, due_at, priority, status, assigned_to, task_type, deadline_type, risk_level, confidentiality_level',
      )
      .single();

    const updateResult =
      extendedUpdateResult.error && isMissingColumnError(extendedUpdateResult.error)
        ? await admin
            .from('office_tasks')
            .update({
              title: payload.title ?? undefined,
              description: payload.description === undefined ? undefined : payload.description,
              due_at: payload.scheduledAt ?? undefined,
              priority: payload.priority ?? undefined,
              status: payload.status ?? undefined,
              assigned_to: payload.assignedTo === undefined ? undefined : payload.assignedTo,
              updated_at: new Date().toISOString(),
            })
            .eq('id', payload.itemId)
            .eq('case_id', payload.caseId)
            .select('id, case_id, title, description, due_at, priority, status, assigned_to')
            .single()
        : extendedUpdateResult;

    if (updateResult.error || !updateResult.data) {
      return Response.json({ error: 'Gorev takvim kaydi guncellenemedi.' }, { status: 500 });
    }

    const updatedTask = updateResult.data as {
      id: string;
      case_id: string;
      title: string;
      description: string | null;
      due_at: string | null;
      priority: 'low' | 'normal' | 'high';
      status: 'open' | 'in_progress' | 'done';
      assigned_to: string | null;
      task_type?: string | null;
      deadline_type?: string | null;
      risk_level?: string | null;
      confidentiality_level?: string | null;
    };

    try {
      await syncTaskReminderTimelineEvents(admin, {
        caseId: payload.caseId,
        taskId: updatedTask.id,
        taskTitle: updatedTask.title,
        taskDescription: updatedTask.description,
        dueAt: updatedTask.due_at,
        createdBy: access.userId,
        priority: updatedTask.priority,
        assignedTo: updatedTask.assigned_to,
        taskType: updatedTask.task_type ?? 'follow_up',
        deadlineType: updatedTask.deadline_type ?? 'due_date',
        riskLevel: updatedTask.risk_level ?? 'medium',
        confidentiality: updatedTask.confidentiality_level ?? 'team',
      });
    } catch (syncError) {
      console.error('calendar_task_update_sync_failed', syncError);
    }

    await logDashboardAudit(admin, {
      actorUserId: access.userId,
      action: 'calendar_task_updated',
      entityType: 'office_task',
      entityId: updatedTask.id,
      metadata: {
        caseId: payload.caseId,
      },
    });

    return Response.json({
      item: {
        id: updatedTask.id,
        source: 'task_deadline',
      },
      conflictWarning,
    });
  }

  const existingEvent = await admin
    .from('case_timeline_events')
    .select('id, case_id, title, description, metadata')
    .eq('id', payload.itemId)
    .eq('case_id', payload.caseId)
    .eq('event_type', 'reminder')
    .is('deleted_at', null)
    .maybeSingle();

  if (existingEvent.error) {
    return Response.json({ error: 'Takvim event kaydi alinamadi.' }, { status: 500 });
  }

  if (!existingEvent.data) {
    return Response.json({ error: 'Takvim event kaydi bulunamadi.' }, { status: 404 });
  }

  if (isTaskLinkedReminder(existingEvent.data.metadata)) {
    return Response.json({ error: 'Bu kayit gorev senkronu ile olustu. Duzenleme icin gorevi guncelleyin.' }, { status: 409 });
  }

  const metadataAssigneeId = getAssigneeIdFromMetadata(existingEvent.data.metadata);
  const conflictScheduledAt = payload.scheduledAt ?? extractScheduledAt(existingEvent.data.metadata);
  let conflictWarning: CalendarConflictWarning | null = null;
  try {
    conflictWarning = await detectCalendarConflicts(admin, access, {
      assigneeId: metadataAssigneeId,
      scheduledAt: conflictScheduledAt,
      excludeTimelineEventId: payload.itemId,
    });
  } catch (conflictError) {
    console.error('calendar_timeline_conflict_detection_failed', conflictError);
  }

  const nextMetadata = asObject(existingEvent.data.metadata);
  if (payload.scheduledAt !== undefined) {
    nextMetadata.scheduledAt = payload.scheduledAt;
  }
  if (payload.eventKind !== undefined) {
    nextMetadata.eventKind = payload.eventKind;
  }

  const timelineUpdateResult = await admin
    .from('case_timeline_events')
    .update({
      title: payload.title ?? undefined,
      description: payload.description === undefined ? undefined : payload.description,
      metadata: nextMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payload.itemId)
    .eq('case_id', payload.caseId)
    .eq('event_type', 'reminder')
    .is('deleted_at', null)
    .select('id')
    .single();

  if (timelineUpdateResult.error || !timelineUpdateResult.data) {
    return Response.json({ error: 'Takvim event guncellenemedi.' }, { status: 500 });
  }

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'calendar_event_updated',
    entityType: 'case_timeline_event',
    entityId: payload.itemId,
    metadata: {
      caseId: payload.caseId,
    },
  });

  return Response.json({
    item: {
      id: payload.itemId,
      source: 'timeline_event',
    },
    conflictWarning,
  });
}

export async function DELETE(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = deleteCalendarItemSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Gecersiz takvim silme verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId: payload.caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyada takvim silme yetkiniz yok.' }, { status: 403 });
  }

  if (payload.source === 'task_deadline') {
    const existingTask = await admin
      .from('office_tasks')
      .select('id, case_id, title, due_at, priority, assigned_to, task_type, deadline_type, risk_level, confidentiality_level')
      .eq('id', payload.itemId)
      .eq('case_id', payload.caseId)
      .maybeSingle();

    if (existingTask.error) {
      return Response.json({ error: 'Gorev kaydi alinamadi.' }, { status: 500 });
    }

    if (!existingTask.data) {
      return Response.json({ error: 'Gorev kaydi bulunamadi.' }, { status: 404 });
    }

    const clearResult = await admin
      .from('office_tasks')
      .update({
        status: 'done',
        due_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payload.itemId)
      .eq('case_id', payload.caseId);

    if (clearResult.error) {
      return Response.json({ error: 'Gorev takvimden kaldirilamadi.' }, { status: 500 });
    }

    try {
      await syncTaskReminderTimelineEvents(admin, {
        caseId: payload.caseId,
        taskId: existingTask.data.id,
        taskTitle: existingTask.data.title,
        taskDescription: null,
        dueAt: null,
        createdBy: access.userId,
        priority: existingTask.data.priority,
        assignedTo: existingTask.data.assigned_to,
        taskType: existingTask.data.task_type,
        deadlineType: existingTask.data.deadline_type,
        riskLevel: existingTask.data.risk_level,
        confidentiality: existingTask.data.confidentiality_level,
      });
    } catch (syncError) {
      console.error('calendar_task_delete_sync_failed', syncError);
    }

    await logDashboardAudit(admin, {
      actorUserId: access.userId,
      action: 'calendar_task_removed',
      entityType: 'office_task',
      entityId: payload.itemId,
      metadata: {
        caseId: payload.caseId,
      },
    });

    return Response.json({ success: true });
  }

  const existingEvent = await admin
    .from('case_timeline_events')
    .select('id, metadata')
    .eq('id', payload.itemId)
    .eq('case_id', payload.caseId)
    .eq('event_type', 'reminder')
    .is('deleted_at', null)
    .maybeSingle();

  if (existingEvent.error) {
    return Response.json({ error: 'Takvim event kaydi alinamadi.' }, { status: 500 });
  }

  if (!existingEvent.data) {
    return Response.json({ error: 'Takvim event kaydi bulunamadi.' }, { status: 404 });
  }

  if (isTaskLinkedReminder(existingEvent.data.metadata)) {
    return Response.json({ error: 'Bu kayit gorev senkronu ile olustu. Silme icin gorevi duzenleyin.' }, { status: 409 });
  }

  const deleteResult = await admin
    .from('case_timeline_events')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', payload.itemId)
    .eq('case_id', payload.caseId)
    .eq('event_type', 'reminder')
    .is('deleted_at', null);

  if (deleteResult.error) {
    return Response.json({ error: 'Takvim event silinemedi.' }, { status: 500 });
  }

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'calendar_event_deleted',
    entityType: 'case_timeline_event',
    entityId: payload.itemId,
    metadata: {
      caseId: payload.caseId,
    },
  });

  return Response.json({ success: true });
}
