import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';

const updateCaseStatusSchema = z.object({
  caseIds: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(['open', 'in_progress', 'closed', 'archived']),
});

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = updateCaseStatusSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz durum güncelleme verisi.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const payload = parsed.data;

  const { data, error } = await admin
    .from('cases')
    .update({
      status: payload.status,
      updated_at: new Date().toISOString(),
    })
    .in('id', payload.caseIds)
    .select('id');

  if (error) {
    return Response.json({ error: 'Dosya durumu güncellenemedi.' }, { status: 500 });
  }

  return Response.json({
    updatedCount: data?.length ?? 0,
    status: payload.status,
  });
}
