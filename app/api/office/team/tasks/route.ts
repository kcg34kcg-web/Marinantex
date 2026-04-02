import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { publishOfficeNotification } from '@/lib/office/notifications';
import { createAdminClient } from '@/utils/supabase/admin';
import { resolveInternalUserBureauScope } from '@/lib/dashboard/client-access';

const createTaskSchema = z.object({
  messageId: z.string().uuid(),
  threadId: z.string().uuid(),
  title: z.string().min(3).max(180),
  description: z.string().max(4000).optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  assignedTo: z.string().uuid().optional(),
  dueAt: z.string().datetime().optional(),
});

export async function GET() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const membershipResult = await access.supabase
    .from('office_thread_members')
    .select('thread_id')
    .eq('user_id', access.userId);

  if (membershipResult.error) {
    return Response.json({ error: 'Görevler alınamadı.' }, { status: 500 });
  }

  const threadIds = [...new Set((membershipResult.data ?? []).map((item) => item.thread_id))];
  if (threadIds.length === 0) {
    return Response.json({ tasks: [] });
  }

  const { data, error } = await access.supabase
    .from('office_tasks')
    .select('id, thread_id, title, status, priority, assigned_to, due_at, created_at')
    .in('thread_id', threadIds)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    return Response.json({ error: 'Görevler alınamadı.' }, { status: 500 });
  }

  return Response.json({ tasks: data ?? [] });
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = createTaskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz görev verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const membershipResult = await access.supabase
    .from('office_thread_members')
    .select('thread_id')
    .eq('thread_id', payload.threadId)
    .eq('user_id', access.userId)
    .maybeSingle();

  if (membershipResult.error || !membershipResult.data) {
    return Response.json({ error: 'Bu sohbette gorev olusturma yetkiniz yok.' }, { status: 403 });
  }

  const admin = createAdminClient();
  const scope = await resolveInternalUserBureauScope(admin, access.userId);
  if (!scope) {
    return Response.json({ error: 'Büro kapsamı doğrulanamadı.' }, { status: 403 });
  }

  const { data: messageExists } = await access.supabase
    .from('office_messages')
    .select('id')
    .eq('id', payload.messageId)
    .eq('thread_id', payload.threadId)
    .maybeSingle();

  if (!messageExists) {
    return Response.json({ error: 'Kaynak mesaj bulunamadı.' }, { status: 404 });
  }

  const assigneeId = payload.assignedTo ?? access.userId;
  if (!scope.bureauProfileIds.includes(assigneeId)) {
    return Response.json({ error: 'Görev atananı ofis kapsamı dışında.' }, { status: 400 });
  }

  const assigneeCheck = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', assigneeId)
    .in('role', ['lawyer', 'assistant'])
    .maybeSingle();

  if (assigneeCheck.error || !assigneeCheck.data) {
    return Response.json({ error: 'Görev atananı ofis kapsamı dışında.' }, { status: 400 });
  }

  const { data, error } = await access.supabase
    .from('office_tasks')
    .insert({
      source_message_id: payload.messageId,
      thread_id: payload.threadId,
      title: payload.title,
      description: payload.description ?? null,
      priority: payload.priority,
      assigned_to: assigneeId,
      created_by: access.userId,
      due_at: payload.dueAt ?? null,
      status: 'open',
      updated_at: new Date().toISOString(),
    })
    .select('id, thread_id, title, status, priority, assigned_to, due_at, created_at')
    .single();

  if (error || !data) {
    return Response.json({ error: 'Mesaj görev olarak oluşturulamadı.' }, { status: 500 });
  }

  publishOfficeNotification({
    type: 'deadline_confirmed',
    category: 'tasks',
    title: 'Mesaj görev olarak kaydedildi',
    detail: payload.title,
    actionUrl: '/office',
    actionLabel: 'Görevi Gör',
    bureauId: access.bureauId,
    recipientUserIds: [assigneeId],
  });

  return Response.json({ task: data });
}
