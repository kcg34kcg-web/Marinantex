import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { canAccessCase } from '@/lib/dashboard/access';
import { resolveInternalUserBureauScope } from '@/lib/dashboard/client-access';
import { logDashboardAudit } from '@/lib/dashboard/audit';
import { syncTaskReminderTimelineEvents } from '@/lib/dashboard/calendar-sync';

const taskTypeSchema = z.enum([
  'follow_up',
  'petition_drafting',
  'contract_review',
  'precedent_research',
  'hearing_preparation',
  'client_meeting',
  'service_tracking',
  'uyap_control',
]);

const deadlineTypeSchema = z.enum([
  'due_date',
  'objection_deadline',
  'response_deadline',
  'hearing_date',
  'service_control',
]);

const riskLevelSchema = z.enum(['low', 'medium', 'critical']);
const confidentialitySchema = z.enum(['team', 'restricted']);

const createCaseTaskSchema = z.object({
  caseId: z.string().uuid(),
  title: z.string().min(3).max(180),
  description: z.string().max(4000).optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  dueAt: z.string().datetime().optional(),
  assignedTo: z.string().uuid().optional(),
  taskType: taskTypeSchema.optional(),
  deadlineType: deadlineTypeSchema.optional(),
  riskLevel: riskLevelSchema.optional(),
  confidentiality: confidentialitySchema.optional(),
  court: z.string().min(2).max(180).optional(),
  fileNo: z.string().min(2).max(120).optional(),
  opponent: z.string().min(2).max(180).optional(),
  references: z.array(z.string().min(2).max(240)).max(50).optional(),
  selectedDocumentIds: z.array(z.string().uuid()).max(25).optional(),
  attachmentNotes: z.string().max(1500).optional(),
  aiContext: z
    .object({
      subtasks: z.array(z.string().min(2).max(240)).max(20).optional(),
      missingFields: z.array(z.string().min(2).max(240)).max(20).optional(),
      reminderSuggestion: z.string().max(600).optional(),
      templateSuggestion: z.string().max(1200).optional(),
      model: z
        .object({
          provider: z.string().max(80),
          id: z.string().max(120),
        })
        .optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = createCaseTaskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz görev verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();
  const allowed = await canAccessCase(admin, {
    caseId: payload.caseId,
    userId: access.userId,
    role: access.role,
  });
  if (!allowed) {
    return Response.json({ error: 'Bu dosyada görev oluşturma yetkiniz yok.' }, { status: 403 });
  }
  const scope = await resolveInternalUserBureauScope(admin, access.userId);

  const { data: caseRow } = await admin
    .from('cases')
    .select('id, title')
    .eq('id', payload.caseId)
    .maybeSingle();

  if (!caseRow) {
    return Response.json({ error: 'Dosya bulunamadı.' }, { status: 404 });
  }

  if (payload.assignedTo) {
    const assigneeResult = await admin
      .from('profiles')
      .select('id')
      .eq('id', payload.assignedTo)
      .in('role', ['lawyer', 'assistant'])
      .maybeSingle();

    if (assigneeResult.error || !assigneeResult.data) {
      return Response.json({ error: 'Görev atananı geçersiz.' }, { status: 400 });
    }

    if (scope && !scope.bureauProfileIds.includes(payload.assignedTo)) {
      return Response.json({ error: 'Görev atananı ofis kapsamı dışında.' }, { status: 400 });
    }
  }

  const taskDescription = payload.description ?? `Dosya: ${caseRow.title}`;
  const normalizedReferences = (payload.references ?? []).map((item) => item.trim()).filter(Boolean);
  const selectedDocumentIds = [...new Set(payload.selectedDocumentIds ?? [])];

  let relatedDocuments: Array<{ id: string; file_name: string; public_ref_code: string }> = [];
  if (selectedDocumentIds.length > 0) {
    const documentsResult = await admin
      .from('case_documents')
      .select('id, file_name, public_ref_code')
      .eq('case_id', payload.caseId)
      .is('deleted_at', null)
      .in('id', selectedDocumentIds);

    if (documentsResult.error) {
      return Response.json({ error: 'Görev belgeleri doğrulanamadı.' }, { status: 500 });
    }

    relatedDocuments = documentsResult.data ?? [];
    if (relatedDocuments.length !== selectedDocumentIds.length) {
      return Response.json({ error: 'Seçilen belgelerin bir kısmı dosya ile eşleşmiyor.' }, { status: 400 });
    }
  }

  const taskMetadata = {
    taskType: payload.taskType ?? 'follow_up',
    deadlineType: payload.deadlineType ?? 'due_date',
    riskLevel: payload.riskLevel ?? 'medium',
    confidentiality: payload.confidentiality ?? 'team',
    legalContext: {
      court: payload.court ?? null,
      fileNo: payload.fileNo ?? null,
      opponent: payload.opponent ?? null,
    },
    references: normalizedReferences,
    attachmentNotes: payload.attachmentNotes ?? null,
    relatedDocuments: relatedDocuments.map((item) => ({
      id: item.id,
      fileName: item.file_name,
      publicRefCode: item.public_ref_code,
    })),
    aiContext: payload.aiContext ?? null,
  };

  const nowIso = new Date().toISOString();
  const baseInsert = {
    case_id: payload.caseId,
    source_message_id: null,
    thread_id: null,
    title: payload.title,
    description: taskDescription,
    priority: payload.priority,
    assigned_to: payload.assignedTo ?? access.userId,
    created_by: access.userId,
    due_at: payload.dueAt ?? null,
    status: 'open' as const,
    updated_at: nowIso,
  };

  const extendedInsert = {
    ...baseInsert,
    task_type: payload.taskType ?? 'follow_up',
    deadline_type: payload.deadlineType ?? 'due_date',
    risk_level: payload.riskLevel ?? 'medium',
    confidentiality_level: payload.confidentiality ?? 'team',
    metadata: taskMetadata,
  };

  const extendedInsertResult = await admin
    .from('office_tasks')
    .insert(extendedInsert)
    .select('id, title, status, priority, assigned_to, due_at, created_at, task_type, deadline_type, risk_level, confidentiality_level, metadata')
    .single();

  const taskResult =
    extendedInsertResult.error || !extendedInsertResult.data
      ? await admin
          .from('office_tasks')
          .insert(baseInsert)
          .select('id, title, status, priority, assigned_to, due_at, created_at')
          .single()
      : extendedInsertResult;

  if (taskResult.error || !taskResult.data) {
    return Response.json({ error: 'Görev oluşturulamadı.' }, { status: 500 });
  }

  const data = taskResult.data;

  await admin.from('case_timeline_events').insert({
    case_id: payload.caseId,
    event_type: 'user_action',
    title: 'Yeni gorev olusturuldu',
    description: payload.title,
    metadata: {
      taskId: data.id,
      priority: payload.priority,
      dueAt: payload.dueAt ?? null,
      assignedTo: payload.assignedTo ?? access.userId,
      taskType: payload.taskType ?? 'follow_up',
      deadlineType: payload.deadlineType ?? 'due_date',
      riskLevel: payload.riskLevel ?? 'medium',
      confidentiality: payload.confidentiality ?? 'team',
      references: normalizedReferences,
      relatedDocumentIds: relatedDocuments.map((item) => item.id),
      calendarSync: {
        source: 'office_task',
      },
    },
    created_by: access.userId,
  });

  try {
    await syncTaskReminderTimelineEvents(admin, {
      caseId: payload.caseId,
      taskId: data.id,
      taskTitle: payload.title,
      taskDescription: taskDescription ?? null,
      dueAt: payload.dueAt ?? null,
      createdBy: access.userId,
      priority: payload.priority,
      assignedTo: payload.assignedTo ?? access.userId,
      taskType: payload.taskType ?? 'follow_up',
      deadlineType: payload.deadlineType ?? 'due_date',
      riskLevel: payload.riskLevel ?? 'medium',
      confidentiality: payload.confidentiality ?? 'team',
    });
  } catch (syncError) {
    console.error('task_calendar_sync_failed', syncError);
  }

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'case_task_created',
    entityType: 'office_task',
    entityId: data.id,
    metadata: {
      caseId: payload.caseId,
      priority: payload.priority,
      dueAt: payload.dueAt ?? null,
      taskType: payload.taskType ?? 'follow_up',
      deadlineType: payload.deadlineType ?? 'due_date',
      riskLevel: payload.riskLevel ?? 'medium',
      confidentiality: payload.confidentiality ?? 'team',
      references: normalizedReferences,
      relatedDocumentIds: relatedDocuments.map((item) => item.id),
    },
  });

  return Response.json({ task: data });
}
