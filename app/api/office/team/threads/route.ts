import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { resolveInternalUserBureauScope } from '@/lib/dashboard/client-access';

const createThreadSchema = z.object({
  title: z.string().min(1).max(180).optional(),
  threadType: z.enum(['direct', 'group', 'role', 'broadcast']),
  targetRole: z.enum(['lawyer', 'assistant']).optional(),
  memberIds: z.array(z.string().uuid()).optional(),
  initialMessage: z.string().min(1).max(4000).optional(),
});

function toUniqueIds(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value) => value.length > 0))];
}

export async function GET() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const admin = createAdminClient();
  const scope = await resolveInternalUserBureauScope(admin, access.userId);
  if (!scope) {
    return Response.json({ error: 'Büro kapsamı doğrulanamadı.' }, { status: 403 });
  }

  const membershipResult = await admin
    .from('office_thread_members')
    .select('thread_id, user_id, last_read_at')
    .eq('user_id', access.userId);

  if (membershipResult.error) {
    return Response.json({ error: 'Ekip sohbetleri alınamadı.' }, { status: 500 });
  }

  const userMemberships = membershipResult.data ?? [];
  const threadIds = userMemberships.map((item) => item.thread_id);

  if (threadIds.length === 0) {
    return Response.json({ threads: [] });
  }

  const threadsResult = await admin
    .from('office_threads')
    .select('id, title, thread_type, target_role, is_archived, last_message_at, created_at')
    .in('id', threadIds)
    .eq('is_archived', false)
    .order('last_message_at', { ascending: false })
    .limit(50);

  if (threadsResult.error) {
    return Response.json({ error: 'Ekip sohbetleri alınamadı.' }, { status: 500 });
  }

  const threads = threadsResult.data ?? [];
  if (threads.length === 0) {
    return Response.json({ threads: [] });
  }

  const listedThreadIds = threads.map((item) => item.id);
  const allMembershipsResult = await admin
    .from('office_thread_members')
    .select('thread_id, user_id, last_read_at')
    .in('thread_id', listedThreadIds);

  const allMemberships = allMembershipsResult.data ?? [];
  const scopeProfileIdSet = new Set(scope.bureauProfileIds);
  const scopedMemberships = allMemberships.filter((item) => scopeProfileIdSet.has(item.user_id));
  const userIds = [...new Set(scopedMemberships.map((item) => item.user_id))];

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
      .filter((member) => member.user_id !== access.userId && scopeProfileIdSet.has(member.user_id))
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

  if (threadType === 'broadcast') {
    return Response.json({ error: 'Duyurular için broadcast endpointi kullanılmalıdır.' }, { status: 400 });
  }

  if (threadType === 'role' && !payload.targetRole) {
    return Response.json({ error: 'Role sohbeti için hedef rol gereklidir.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const scope = await resolveInternalUserBureauScope(admin, access.userId);
  if (!scope) {
    return Response.json({ error: 'Büro kapsamı doğrulanamadı.' }, { status: 403 });
  }

  const scopeProfileIdSet = new Set(scope.bureauProfileIds);
  const memberSet = new Set<string>([access.userId]);

  if (threadType === 'role' && payload.targetRole) {
    const roleUsersResult = await admin
      .from('profiles')
      .select('id')
      .in('id', scope.bureauProfileIds)
      .eq('role', payload.targetRole);

    if (roleUsersResult.error) {
      return Response.json({ error: 'Rol üyeleri alınamadı.' }, { status: 500 });
    }

    const roleUsers = roleUsersResult.data ?? [];
    if (roleUsers.length === 0) {
      return Response.json({ error: 'Bu rol için ekip üyesi bulunamadı.' }, { status: 400 });
    }

    roleUsers.forEach((item) => memberSet.add(item.id));
  } else {
    const requestedIds = toUniqueIds(payload.memberIds);
    if (requestedIds.length === 0) {
      return Response.json({ error: 'En az bir ekip üyesi seçilmelidir.' }, { status: 400 });
    }

    if (threadType === 'direct' && requestedIds.length !== 1) {
      return Response.json({ error: 'Direct sohbet için tek bir ekip üyesi seçilmelidir.' }, { status: 400 });
    }

    if (requestedIds.some((id) => !scopeProfileIdSet.has(id))) {
      return Response.json({ error: 'Seçilen üyeler ofis kapsamı dışında.' }, { status: 403 });
    }

    const scopedMembersResult = await admin
      .from('profiles')
      .select('id, role')
      .in('id', requestedIds)
      .in('role', ['lawyer', 'assistant']);

    if (scopedMembersResult.error) {
      return Response.json({ error: 'Seçilen ekip üyeleri doğrulanamadı.' }, { status: 500 });
    }

    const scopedMembers = scopedMembersResult.data ?? [];
    if (scopedMembers.length !== requestedIds.length) {
      return Response.json({ error: 'Seçilen üyeler ofis kapsamı dışında.' }, { status: 403 });
    }

    scopedMembers.forEach((item) => memberSet.add(item.id));
  }

  const insertThreadResult = await access.supabase
    .from('office_threads')
    .insert({
      title: payload.title ?? null,
      thread_type: threadType,
      target_role: payload.targetRole ?? null,
      created_by: access.userId,
    })
    .select('id')
    .single();

  if (insertThreadResult.error || !insertThreadResult.data) {
    return Response.json({ error: 'Sohbet oluşturulamadı.' }, { status: 500 });
  }

  const threadId = insertThreadResult.data.id;
  const members = [...memberSet].map((userId) => ({
    thread_id: threadId,
    user_id: userId,
  }));

  const membersResult = await admin.from('office_thread_members').insert(members);
  if (membersResult.error) {
    await admin.from('office_threads').delete().eq('id', threadId);
    return Response.json({ error: 'Sohbet üyeleri eklenemedi.' }, { status: 500 });
  }

  if (payload.initialMessage) {
    const now = new Date().toISOString();

    const messageResult = await access.supabase.from('office_messages').insert({
      thread_id: threadId,
      sender_id: access.userId,
      body: payload.initialMessage,
    });

    if (messageResult.error) {
      return Response.json({ error: 'Sohbet oluşturuldu ancak ilk mesaj gönderilemedi.' }, { status: 500 });
    }

    await access.supabase.from('office_threads').update({ last_message_at: now }).eq('id', threadId);
  }

  return Response.json({
    threadId,
    memberCount: members.length,
  });
}
