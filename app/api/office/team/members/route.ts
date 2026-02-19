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

  return Response.json({
    members: (data ?? []).map((item) => ({
      id: item.id,
      fullName: item.full_name,
      role: item.role,
      isCurrentUser: item.id === access.userId,
    })),
  });
}
