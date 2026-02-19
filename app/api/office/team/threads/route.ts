import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { requireInternalOfficeUser } from '@/lib/office/team-access';

const createThreadSchema = z.object({
  title: z.string().min(1).max(180).optional(),
  threadType: z.enum(['direct', 'group', 'role', 'broadcast']),
  targetRole: z.enum(['lawyer', 'assistant']).optional(),
  memberIds: z.array(z.string().uuid()).optional(),
  initialMessage: z.string().min(1).max(4000).optional(),
});

export async function GET() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const { data, error } = await access.supabase
    .from('office_threads')
    .select('id, title, thread_type, target_role, is_archived, last_message_at, created_at')
    .eq('is_archived', false)
    .order('last_message_at', { ascending: false })
    .limit(50);

  if (error) {
    return Response.json({ error: 'Ekip sohbetleri alınamadı.' }, { status: 500 });
  }

  const threads = data ?? [];
  const threadIds = threads.map((item) => item.id);

  if (threadIds.length === 0) {
    return Response.json({ threads: [] });
  }

  const admin = createAdminClient();
  const { data: memberships } = await admin
    .from('office_thread_members')
    .select('thread_id, user_id, last_read_at')
    .in('thread_id', threadIds);

  const allMemberships = memberships ?? [];
  const userIds = [...new Set(allMemberships.map((item) => item.user_id))];

  const { data: profiles } = userIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', userIds)
    : { data: [] as Array<{ id: string; full_name: string | null }> };

  const profileNameById = new Map<string, string>();
  (profiles ?? []).forEach((item) => profileNameById.set(item.id, item.full_name ?? 'Kullanıcı'));

  const membershipsByThread = new Map<string, Array<{ user_id: string; last_read_at: string | null }>>();
  allMemberships.forEach((item) => {
    const previous = membershipsByThread.get(item.thread_id) ?? [];
    previous.push({ user_id: item.user_id, last_read_at: item.last_read_at });
    membershipsByThread.set(item.thread_id, previous);
  });

  const unreadCounts = await Promise.all(
    threads.map(async (thread) => {
      const currentMembership = (membershipsByThread.get(thread.id) ?? []).find((item) => item.user_id === access.userId);
      const lastReadAt = currentMembership?.last_read_at;

      let query = access.supabase
        .from('office_messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', thread.id)
        .neq('sender_id', access.userId);

      if (lastReadAt) {
        query = query.gt('created_at', lastReadAt);
      }

      const { count } = await query;
      return { threadId: thread.id, unreadCount: count ?? 0 };
    })
  );

  const unreadByThread = new Map(unreadCounts.map((item) => [item.threadId, item.unreadCount]));

  const enrichedThreads = threads.map((thread) => {
    const memberNames = (membershipsByThread.get(thread.id) ?? [])
      .filter((member) => member.user_id !== access.userId)
      .map((member) => profileNameById.get(member.user_id) ?? 'Kullanıcı');

    return {
      ...thread,
      member_names: memberNames,
      unread_count: unreadByThread.get(thread.id) ?? 0,
    };
  });

  return Response.json({ threads: enrichedThreads });
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = createThreadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz ekip sohbet verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const threadType = payload.threadType;

  if (threadType === 'role' && !payload.targetRole) {
    return Response.json({ error: 'Role sohbeti için hedef rol gereklidir.' }, { status: 400 });
  }

  const { data: thread, error: threadError } = await access.supabase
    .from('office_threads')
    .insert({
      title: payload.title ?? null,
      thread_type: threadType,
      target_role: payload.targetRole ?? null,
      created_by: access.userId,
    })
    .select('id')
    .single();

  if (threadError || !thread) {
    return Response.json({ error: 'Sohbet oluşturulamadı.' }, { status: 500 });
  }

  const memberSet = new Set<string>([access.userId]);

  if (threadType === 'role' && payload.targetRole) {
    const admin = createAdminClient();
    const { data: roleUsers } = await admin
      .from('profiles')
      .select('id')
      .eq('role', payload.targetRole);

    (roleUsers ?? []).forEach((item) => memberSet.add(item.id));
  } else if (threadType === 'broadcast') {
    const admin = createAdminClient();
    const { data: internalUsers } = await admin
      .from('profiles')
      .select('id, role')
      .in('role', ['lawyer', 'assistant']);

    (internalUsers ?? []).forEach((item) => memberSet.add(item.id));
  } else {
    (payload.memberIds ?? []).forEach((id) => memberSet.add(id));
  }

  const members = [...memberSet].map((userId) => ({
    thread_id: thread.id,
    user_id: userId,
  }));

  const admin = createAdminClient();
  const { error: membersError } = await admin.from('office_thread_members').insert(members);

  if (membersError) {
    return Response.json({ error: 'Sohbet üyeleri eklenemedi.' }, { status: 500 });
  }

  if (payload.initialMessage) {
    const now = new Date().toISOString();

    await access.supabase.from('office_messages').insert({
      thread_id: thread.id,
      sender_id: access.userId,
      body: payload.initialMessage,
    });

    await access.supabase.from('office_threads').update({ last_message_at: now }).eq('id', thread.id);
  }

  return Response.json({
    threadId: thread.id,
    memberCount: members.length,
  });
}
