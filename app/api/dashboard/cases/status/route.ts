import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { logDashboardAudit } from '@/lib/dashboard/audit';

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

  const updatedCaseIds = (data ?? []).map((item) => item.id);

  if (updatedCaseIds.length > 0) {
    await admin.from('case_timeline_events').insert(
      updatedCaseIds.map((caseId) => ({
        case_id: caseId,
        event_type: 'status_change',
        title: 'Dosya durumu güncellendi',
        description: `Yeni durum: ${payload.status}`,
        metadata: { status: payload.status },
        created_by: access.userId,
      }))
    );

    await logDashboardAudit(admin, {
      actorUserId: access.userId,
      action: 'case_status_bulk_updated',
      entityType: 'case',
      entityId: null,
      metadata: {
        caseIds: updatedCaseIds,
        status: payload.status,
      },
    });
  }

  return Response.json({
    updatedCount: updatedCaseIds.length,
    status: payload.status,
  });
}
