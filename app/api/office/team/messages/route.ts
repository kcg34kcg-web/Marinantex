import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { publishOfficeNotification } from '@/lib/office/notifications';

const sendMessageSchema = z.object({
  threadId: z.string().uuid(),
  body: z.string().min(1).max(4000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const url = new URL(request.url);
  const threadId = url.searchParams.get('threadId');

  if (!threadId) {
    return Response.json({ error: 'threadId gereklidir.' }, { status: 400 });
  }

  const { data, error } = await access.supabase
    .from('office_messages')
    .select('id, thread_id, sender_id, body, metadata, is_deleted, edited_at, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return Response.json({ error: 'Mesajlar alınamadı.' }, { status: 500 });
  }

  await access.supabase
    .from('office_thread_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .eq('user_id', access.userId);

  return Response.json({ messages: (data ?? []).reverse() });
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = sendMessageSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz mesaj verisi.' }, { status: 400 });
  }

  const payload = parsed.data;

  const { data, error } = await access.supabase
    .from('office_messages')
    .insert({
      thread_id: payload.threadId,
      sender_id: access.userId,
      body: payload.body,
      metadata: payload.metadata ?? {},
    })
    .select('id, thread_id, sender_id, body, metadata, is_deleted, edited_at, created_at')
    .single();

  if (error || !data) {
    return Response.json({ error: 'Mesaj gönderilemedi.' }, { status: 500 });
  }

  const now = new Date().toISOString();
  await access.supabase.from('office_threads').update({ last_message_at: now }).eq('id', payload.threadId);

  publishOfficeNotification({
    type: 'risk_communication',
    category: 'messages',
    title: 'Ekip mesajı geldi',
    detail: payload.body.length > 100 ? `${payload.body.slice(0, 97)}...` : payload.body,
    actionUrl: '/office',
    actionLabel: 'Ekibi Aç',
  });

  return Response.json({ message: data });
}
