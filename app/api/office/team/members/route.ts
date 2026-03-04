import { createAdminClient } from '@/utils/supabase/admin';
import { requireInternalOfficeUser } from '@/lib/office/team-access';

export async function GET() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['lawyer', 'assistant'])
    .order('full_name', { ascending: true });

  if (error) {
    return Response.json({ error: 'Ekip üyeleri alınamadı.' }, { status: 500 });
  }

  const memberIds = (data ?? []).map((item) => item.id);
  const recentThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const recentMessagesResult = memberIds.length
    ? await admin
        .from('office_messages')
        .select('sender_id, created_at')
        .in('sender_id', memberIds)
        .gte('created_at', recentThreshold)
    : { data: [], error: null };

  const onlineMemberIdSet = new Set((recentMessagesResult.data ?? []).map((item) => item.sender_id));

  return Response.json({
    members: (data ?? []).map((item) => ({
      id: item.id,
      fullName: item.full_name ?? 'Isimsiz Kullanici',
      role: item.role,
      isCurrentUser: item.id === access.userId,
      isOnline: onlineMemberIdSet.has(item.id),
    })),
  });
}
