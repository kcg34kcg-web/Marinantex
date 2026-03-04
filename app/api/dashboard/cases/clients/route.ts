import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { canAccessCase } from '@/lib/dashboard/access';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const linkSchema = z.object({
  caseId: z.string().uuid(),
  clientIds: z.array(z.string().uuid()).min(1).max(20),
  relationNote: z.string().trim().max(240).optional(),
});

const unlinkSchema = z.object({
  caseId: z.string().uuid(),
  clientId: z.string().uuid(),
});

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = linkSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz iliski verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId: payload.caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyada müvekkil esleme yetkiniz yok.' }, { status: 403 });
  }

  const clientsResult = await admin
    .from('clients')
    .select('id')
    .in('id', payload.clientIds)
    .is('deleted_at', null);

  if (clientsResult.error || (clientsResult.data ?? []).length !== payload.clientIds.length) {
    return Response.json({ error: 'Seçilen müvekkillerden bazilari bulunamadi.' }, { status: 400 });
  }

  const insertRows = payload.clientIds.map((clientId) => ({
    case_id: payload.caseId,
    client_id: clientId,
    relation_note: payload.relationNote ?? null,
    created_by: access.userId,
    deleted_at: null,
  }));

  const upsertResult = await admin.from('case_clients').upsert(insertRows, {
    onConflict: 'case_id,client_id',
    ignoreDuplicates: false,
  });

  if (upsertResult.error) {
    return Response.json({ error: 'Müvekkil eslesmesi kaydedilemedi.' }, { status: 500 });
  }

  await admin.from('case_timeline_events').insert({
    case_id: payload.caseId,
    event_type: 'user_action',
    title: 'Müvekkil eslestirmesi güncellendi',
    description: `${payload.clientIds.length} müvekkil dosyaya baglandi.`,
    metadata: {
      clientIds: payload.clientIds,
      relationNote: payload.relationNote ?? null,
    },
    created_by: access.userId,
  });

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'case_client_linked',
    entityType: 'case',
    entityId: payload.caseId,
    metadata: {
      clientIds: payload.clientIds,
    },
  });

  return Response.json({ linkedCount: payload.clientIds.length });
}

export async function DELETE(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = unlinkSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz iliski kaldirma verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId: payload.caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyada müvekkil esleme yetkiniz yok.' }, { status: 403 });
  }

  const updateResult = await admin
    .from('case_clients')
    .update({ deleted_at: new Date().toISOString() })
    .eq('case_id', payload.caseId)
    .eq('client_id', payload.clientId)
    .is('deleted_at', null);

  if (updateResult.error) {
    return Response.json({ error: 'Müvekkil eslesmesi kaldirilamadi.' }, { status: 500 });
  }

  await admin.from('case_timeline_events').insert({
    case_id: payload.caseId,
    event_type: 'user_action',
    title: 'Müvekkil eslesmesi kaldirildi',
    description: 'Dosya ile müvekkil baglantisi kaldirildi.',
    metadata: {
      clientId: payload.clientId,
    },
    created_by: access.userId,
  });

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'case_client_unlinked',
    entityType: 'case',
    entityId: payload.caseId,
    metadata: {
      clientId: payload.clientId,
    },
  });

  return Response.json({ success: true });
}

