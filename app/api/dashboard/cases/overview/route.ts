import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { canAccessCase } from '@/lib/dashboard/access';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const querySchema = z.object({
  caseId: z.string().uuid(),
});

const updateSchema = z.object({
  caseId: z.string().uuid(),
  overviewNotes: z.string().max(20000),
});

export async function GET(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = querySchema.safeParse({
    caseId: new URL(request.url).searchParams.get('caseId'),
  });

  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz caseId.' }, { status: 400 });
  }

  const caseId = parsed.data.caseId;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyanin not alanina erisim yetkiniz yok.' }, { status: 403 });
  }

  const caseResult = await admin
    .from('cases')
    .select('id, overview_notes, overview_notes_updated_at, overview_notes_updated_by')
    .eq('id', caseId)
    .maybeSingle();

  if (caseResult.error || !caseResult.data) {
    return Response.json({ error: 'Dosya bulunamadi.' }, { status: 404 });
  }

  return Response.json({
    overviewNotes: caseResult.data.overview_notes ?? '',
    updatedAt: caseResult.data.overview_notes_updated_at,
    updatedBy: caseResult.data.overview_notes_updated_by,
  });
}

export async function PATCH(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz genel bakis notu verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId: payload.caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyada not güncelleme yetkiniz yok.' }, { status: 403 });
  }

  const now = new Date().toISOString();

  const updateResult = await admin
    .from('cases')
    .update({
      overview_notes: payload.overviewNotes,
      overview_notes_updated_at: now,
      overview_notes_updated_by: access.userId,
      updated_at: now,
    })
    .eq('id', payload.caseId)
    .select('id, overview_notes_updated_at')
    .single();

  if (updateResult.error || !updateResult.data) {
    return Response.json({ error: 'Genel bakis notu kaydedilemedi.' }, { status: 500 });
  }

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'case_overview_updated',
    entityType: 'case',
    entityId: payload.caseId,
    metadata: {
      length: payload.overviewNotes.length,
    },
  });

  return Response.json({
    success: true,
    updatedAt: updateResult.data.overview_notes_updated_at,
  });
}

