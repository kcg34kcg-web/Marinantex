import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { canAccessCase } from '@/lib/dashboard/access';
import { resolveInternalUserBureauScope } from '@/lib/dashboard/client-access';
import { logDashboardAudit } from '@/lib/dashboard/audit';
import { syncTaskReminderTimelineEvents } from '@/lib/dashboard/calendar-sync';

const createBulkCaseTaskSchema = z.object({
  caseIds: z.array(z.string().uuid()).min(1).max(100),
  title: z.string().min(3).max(180),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  dueAt: z.string().datetime().optional(),
  assignedTo: z.string().uuid().optional(),
});

type CreatedTaskRow = {
  id: string;
  case_id: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  priority: 'low' | 'normal' | 'high';
  assigned_to: string | null;
};

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = createBulkCaseTaskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz toplu görev verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();
  const uniqueCaseIds = [...new Set(payload.caseIds)];
  const scope = await resolveInternalUserBureauScope(admin, access.userId);

  const accessChecks = await Promise.all(
    uniqueCaseIds.map(async (caseId) => ({
      caseId,
      allowed: await canAccessCase(admin, {
        caseId,
        userId: access.userId,
        role: access.role,
      }),
    }))
  );
  if (accessChecks.some((item) => !item.allowed)) {
    return Response.json({ error: 'Seçilen dosyalardan en az birine erişim yetkiniz yok.' }, { status: 403 });
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

  const { data: cases, error: casesError } = await admin
    .from('cases')
    .select('id, title')
    .in('id', uniqueCaseIds);

  if (casesError) {
    return Response.json({ error: 'Dosya listesi doğrulanamadı.' }, { status: 500 });
  }

  if (!cases || cases.length === 0) {
    return Response.json({ error: 'Görev açılacak dosya bulunamadı.' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const inserts = cases.map((item) => ({
    case_id: item.id,
    source_message_id: null,
    thread_id: null,
    title: `${payload.title} · ${item.title}`,
    description: `Toplu görev - Dosya: ${item.title}`,
    priority: payload.priority,
    assigned_to: payload.assignedTo ?? access.userId,
    created_by: access.userId,
    due_at: payload.dueAt ?? null,
    status: 'open' as const,
    updated_at: now,
  }));

  const insertResult = await admin
    .from('office_tasks')
    .insert(inserts)
    .select('id, case_id, title, description, due_at, priority, assigned_to');

  if (insertResult.error || !insertResult.data) {
    return Response.json({ error: 'Toplu görev oluşturulamadı.' }, { status: 500 });
  }

  const createdTasks = insertResult.data as CreatedTaskRow[];
  const tasksWithCase = createdTasks.filter((item): item is CreatedTaskRow & { case_id: string } => Boolean(item.case_id));

  await admin.from('case_timeline_events').insert(
    tasksWithCase.map((item) => ({
        case_id: item.case_id,
        event_type: 'user_action',
        title: 'Toplu gorev olusturuldu',
        description: item.title,
        metadata: {
          taskId: item.id,
          priority: item.priority,
          dueAt: item.due_at,
          assignedTo: item.assigned_to,
          calendarSync: {
            source: 'office_task',
          },
        },
        created_by: access.userId,
      }))
  );

  await Promise.all(
    tasksWithCase.map(async (item) => {
        try {
          await syncTaskReminderTimelineEvents(admin, {
            caseId: item.case_id,
            taskId: item.id,
            taskTitle: item.title,
            taskDescription: item.description ?? null,
            dueAt: item.due_at,
            createdBy: access.userId,
            priority: item.priority,
            assignedTo: item.assigned_to,
            taskType: null,
            deadlineType: null,
            riskLevel: null,
            confidentiality: null,
          });
        } catch (syncError) {
          console.error('bulk_task_calendar_sync_failed', syncError);
        }
      })
  );

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'case_task_bulk_created',
    entityType: 'office_task',
    entityId: null,
    metadata: {
      caseIds: uniqueCaseIds,
      count: inserts.length,
      priority: payload.priority,
      dueAt: payload.dueAt ?? null,
    },
  });

  return Response.json({ createdCount: inserts.length });
}
