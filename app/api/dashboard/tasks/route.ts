import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';

type BaseTaskRow = {
  id: string;
  case_id: string | null;
  title: string;
  description: string | null;
  status: 'open' | 'in_progress' | 'done';
  priority: 'low' | 'normal' | 'high';
  assigned_to: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

type ExtendedTaskRow = BaseTaskRow & {
  task_type?: string | null;
  deadline_type?: string | null;
  risk_level?: string | null;
  confidentiality_level?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function GET() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const admin = createAdminClient();

  let visibleCaseIds: string[] | null = null;
  if (access.role === 'lawyer') {
    const caseScope = await admin.from('cases').select('id').eq('lawyer_id', access.userId);
    if (caseScope.error) {
      return Response.json({ error: 'Dosya erisim alani dogrulanamadi.' }, { status: 500 });
    }

    visibleCaseIds = (caseScope.data ?? []).map((item) => item.id);
    if (visibleCaseIds.length === 0) {
      return Response.json({ items: [] });
    }
  }

  let rows: ExtendedTaskRow[] = [];
  let usedLegacySelect = false;

  const extendedQuery = admin
    .from('office_tasks')
    .select(
      'id, case_id, title, description, status, priority, assigned_to, due_at, created_at, updated_at, task_type, deadline_type, risk_level, confidentiality_level, metadata'
    )
    .order('created_at', { ascending: false })
    .limit(300);

  if (visibleCaseIds) {
    extendedQuery.in('case_id', visibleCaseIds);
  }

  const extendedResult = await extendedQuery;

  if (!extendedResult.error) {
    rows = (extendedResult.data ?? []) as ExtendedTaskRow[];
  } else {
    usedLegacySelect = true;
    const legacyQuery = admin
      .from('office_tasks')
      .select('id, case_id, title, description, status, priority, assigned_to, due_at, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(300);

    if (visibleCaseIds) {
      legacyQuery.in('case_id', visibleCaseIds);
    }

    const legacyResult = await legacyQuery;
    if (legacyResult.error) {
      return Response.json({ error: 'Gorevler alinamadi.' }, { status: 500 });
    }

    rows = (legacyResult.data ?? []) as ExtendedTaskRow[];
  }

  const caseIds = [...new Set(rows.map((row) => row.case_id).filter((id): id is string => Boolean(id)))];
  const assigneeIds = [...new Set(rows.map((row) => row.assigned_to).filter((id): id is string => Boolean(id)))];

  const [caseResult, assigneeResult] = await Promise.all([
    caseIds.length
      ? admin.from('cases').select('id, title').in('id', caseIds)
      : Promise.resolve({ data: [], error: null }),
    assigneeIds.length
      ? admin.from('profiles').select('id, full_name').in('id', assigneeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (caseResult.error) {
    return Response.json({ error: 'Gorev dosya bilgileri alinamadi.' }, { status: 500 });
  }

  if (assigneeResult.error) {
    return Response.json({ error: 'Gorev sorumlu bilgileri alinamadi.' }, { status: 500 });
  }

  const caseTitleById = new Map((caseResult.data ?? []).map((item) => [item.id, item.title]));
  const assigneeNameById = new Map((assigneeResult.data ?? []).map((item) => [item.id, item.full_name]));

  return Response.json({
    items: rows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      caseTitle: row.case_id ? caseTitleById.get(row.case_id) ?? null : null,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assignedTo: row.assigned_to,
      assignedName: row.assigned_to ? assigneeNameById.get(row.assigned_to) ?? null : null,
      dueAt: row.due_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      taskType: usedLegacySelect ? 'follow_up' : row.task_type ?? 'follow_up',
      deadlineType: usedLegacySelect ? 'due_date' : row.deadline_type ?? 'due_date',
      riskLevel: usedLegacySelect ? 'medium' : row.risk_level ?? 'medium',
      confidentiality: usedLegacySelect ? 'team' : row.confidentiality_level ?? 'team',
      metadata: usedLegacySelect ? {} : (row.metadata ?? {}),
    })),
  });
}
