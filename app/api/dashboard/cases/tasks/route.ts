import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const createCaseTaskSchema = z.object({
  caseId: z.string().uuid(),
  title: z.string().min(3).max(180),
  description: z.string().max(4000).optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  dueAt: z.string().datetime().optional(),
  assignedTo: z.string().uuid().optional(),
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

  const { data: caseRow } = await admin
    .from('cases')
    .select('id, title')
    .eq('id', payload.caseId)
    .maybeSingle();

  if (!caseRow) {
    return Response.json({ error: 'Dosya bulunamadı.' }, { status: 404 });
  }

  const taskDescription = payload.description ?? `Dosya: ${caseRow.title}`;

  const { data, error } = await admin
    .from('office_tasks')
    .insert({
      case_id: payload.caseId,
      source_message_id: null,
      thread_id: null,
      title: payload.title,
      description: taskDescription,
      priority: payload.priority,
      assigned_to: payload.assignedTo ?? access.userId,
      created_by: access.userId,
      due_at: payload.dueAt ?? null,
      status: 'open',
      updated_at: new Date().toISOString(),
    })
    .select('id, title, status, priority, assigned_to, due_at, created_at')
    .single();

  if (error || !data) {
    return Response.json({ error: 'Görev oluşturulamadı.' }, { status: 500 });
  }

  await admin.from('case_timeline_events').insert({
    case_id: payload.caseId,
    event_type: 'reminder',
    title: 'Yeni görev oluşturuldu',
    description: payload.title,
    metadata: {
      taskId: data.id,
      priority: payload.priority,
      dueAt: payload.dueAt ?? null,
      assignedTo: payload.assignedTo ?? access.userId,
    },
    created_by: access.userId,
  });

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'case_task_created',
    entityType: 'office_task',
    entityId: data.id,
    metadata: {
      caseId: payload.caseId,
      priority: payload.priority,
      dueAt: payload.dueAt ?? null,
    },
  });

  return Response.json({ task: data });
}
