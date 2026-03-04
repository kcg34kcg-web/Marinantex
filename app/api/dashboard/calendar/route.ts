import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { canAccessCase } from '@/lib/dashboard/access';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const listQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  caseId: z.string().uuid().optional(),
});

const createCalendarEventSchema = z.object({
  caseId: z.string().uuid(),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  eventKind: z.enum(['hearing', 'service', 'delivery', 'deadline', 'reminder']).default('reminder'),
  scheduledAt: z.string().datetime(),
  tags: z.array(z.string().trim().min(1).max(30)).max(8).optional(),
});

type CalendarEventKind = 'hearing' | 'service' | 'delivery' | 'deadline' | 'reminder';
type CalendarItemSource = 'task_deadline' | 'timeline_event' | 'limitation_acceptance';
type CalendarTemporalStatus = 'overdue' | 'today' | 'upcoming';

interface CalendarListItem {
  id: string;
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
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractScheduledAt(metadata: unknown): string | null {
  const candidates = [
    getMetadataValue(metadata, 'scheduledAt'),
    getMetadataValue(metadata, 'dueAt'),
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

export async function GET(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const today = toDateOnly(new Date());
  const nextThirtyDays = toDateOnly(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

  const parsed = listQuerySchema.safeParse({
    from: new URL(request.url).searchParams.get('from') ?? undefined,
    to: new URL(request.url).searchParams.get('to') ?? undefined,
    caseId: new URL(request.url).searchParams.get('caseId') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: 'Gecersiz takvim sorgusu.' }, { status: 400 });
  }

  const from = parsed.data.from ?? today;
  const to = parsed.data.to ?? nextThirtyDays;
  const requestedCaseId = parsed.data.caseId;

  if (from > to) {
    return Response.json({ error: 'Tarih araligi gecersiz.' }, { status: 400 });
  }

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
      items: [],
    });
  }

  const [tasksResult, timelineResult, limitationResult] = await Promise.all([
    admin
      .from('office_tasks')
      .select('id, case_id, title, description, status, priority, due_at')
      .in('case_id', caseIds)
      .not('due_at', 'is', null)
      .gte('due_at', `${from}T00:00:00+03:00`)
      .lte('due_at', `${to}T23:59:59.999+03:00`)
      .order('due_at', { ascending: true })
      .limit(1000),
    admin
      .from('case_timeline_events')
      .select('id, case_id, title, description, metadata, created_at')
      .in('case_id', caseIds)
      .eq('event_type', 'reminder')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1000),
    admin
      .from('limitation_acceptances')
      .select('id, case_id, estimated_date, accepted_at')
      .in('case_id', caseIds)
      .gte('estimated_date', from)
      .lte('estimated_date', to)
      .order('estimated_date', { ascending: true })
      .limit(500),
  ]);

  if (tasksResult.error && tasksResult.error.code !== '42P01') {
    return Response.json({ error: 'Takvim gorev verisi alinamadi.' }, { status: 500 });
  }
  if (timelineResult.error && timelineResult.error.code !== '42P01') {
    return Response.json({ error: 'Takvim event verisi alinamadi.' }, { status: 500 });
  }
  if (limitationResult.error && limitationResult.error.code !== '42P01') {
    return Response.json({ error: 'Sure kabul verisi alinamadi.' }, { status: 500 });
  }

  const items: CalendarListItem[] = [];

  (tasksResult.data ?? []).forEach((row) => {
    const relatedCase = caseMap.get(row.case_id ?? '');
    if (!relatedCase || !row.due_at) {
      return;
    }

    items.push({
      id: `task-${row.id}`,
      source: 'task_deadline',
      eventKind: 'deadline',
      temporalStatus: resolveTemporalStatus(row.due_at),
      when: row.due_at,
      title: row.title,
      description: row.description,
      caseId: row.case_id ?? '',
      caseTitle: relatedCase.title,
      caseFileNo: relatedCase.fileNo,
      priority: row.priority,
      taskStatus: row.status,
    });
  });

  (timelineResult.data ?? []).forEach((row) => {
    const relatedCase = caseMap.get(row.case_id);
    if (!relatedCase) {
      return;
    }

    const scheduledAt = extractScheduledAt(row.metadata);
    if (!scheduledAt || !withinRange(scheduledAt, from, to)) {
      return;
    }

    items.push({
      id: `timeline-${row.id}`,
      source: 'timeline_event',
      eventKind: extractEventKind(row.metadata),
      temporalStatus: resolveTemporalStatus(scheduledAt),
      when: scheduledAt,
      title: row.title,
      description: row.description,
      caseId: row.case_id,
      caseTitle: relatedCase.title,
      caseFileNo: relatedCase.fileNo,
      priority: null,
      taskStatus: null,
    });
  });

  (limitationResult.data ?? []).forEach((row) => {
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
    });
  });

  items.sort((left, right) => left.when.localeCompare(right.when));

  return Response.json({
    range: { from, to },
    summary: {
      total: items.length,
      overdue: items.filter((item) => item.temporalStatus === 'overdue').length,
      today: items.filter((item) => item.temporalStatus === 'today').length,
      upcoming: items.filter((item) => item.temporalStatus === 'upcoming').length,
    },
    cases: availableCases,
    items,
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
