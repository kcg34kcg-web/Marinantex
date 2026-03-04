import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { canAccessCase } from '@/lib/dashboard/access';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const listQuerySchema = z.object({
  caseId: z.string().uuid(),
});

const createSchema = z.object({
  caseId: z.string().uuid(),
  eventType: z.enum(['note', 'document_upload', 'message_sent', 'status_change', 'reminder', 'user_action']),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateSchema = z.object({
  eventId: z.string().uuid(),
  caseId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const deleteSchema = z.object({
  eventId: z.string().uuid(),
  caseId: z.string().uuid(),
});

export async function GET(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = listQuerySchema.safeParse({
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
    return Response.json({ error: 'Bu dosyanin zaman çizelgesine erisim yetkiniz yok.' }, { status: 403 });
  }

  const timelineResult = await admin
    .from('case_timeline_events')
    .select('id, event_type, title, description, metadata, created_by, created_at, updated_at')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(500);

  if (timelineResult.error) {
    return Response.json({ error: 'Zaman çizelgesi alinamadi.' }, { status: 500 });
  }

  return Response.json({
    items: (timelineResult.data ?? []).map((item) => ({
      id: item.id,
      eventType: item.event_type,
      title: item.title,
      description: item.description,
      metadata: item.metadata ?? {},
      createdBy: item.created_by,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })),
  });
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz timeline event verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId: payload.caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyada event ekleme yetkiniz yok.' }, { status: 403 });
  }

  const insertResult = await admin
    .from('case_timeline_events')
    .insert({
      case_id: payload.caseId,
      event_type: payload.eventType,
      title: payload.title,
      description: payload.description ?? null,
      metadata: payload.metadata ?? {},
      created_by: access.userId,
    })
    .select('id, event_type, title, description, metadata, created_by, created_at, updated_at')
    .single();

  if (insertResult.error || !insertResult.data) {
    return Response.json({ error: 'Timeline event kaydedilemedi.' }, { status: 500 });
  }

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'case_timeline_event_created',
    entityType: 'case_timeline_event',
    entityId: insertResult.data.id,
    metadata: {
      caseId: payload.caseId,
      eventType: payload.eventType,
    },
  });

  return Response.json({
    event: {
      id: insertResult.data.id,
      eventType: insertResult.data.event_type,
      title: insertResult.data.title,
      description: insertResult.data.description,
      metadata: insertResult.data.metadata ?? {},
      createdBy: insertResult.data.created_by,
      createdAt: insertResult.data.created_at,
      updatedAt: insertResult.data.updated_at,
    },
  });
}

export async function PATCH(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz timeline event güncelleme verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId: payload.caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyada event düzenleme yetkiniz yok.' }, { status: 403 });
  }

  const updateResult = await admin
    .from('case_timeline_events')
    .update({
      title: payload.title,
      description: payload.description === undefined ? undefined : payload.description,
      metadata: payload.metadata ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payload.eventId)
    .eq('case_id', payload.caseId)
    .is('deleted_at', null)
    .select('id, event_type, title, description, metadata, created_by, created_at, updated_at')
    .single();

  if (updateResult.error || !updateResult.data) {
    return Response.json({ error: 'Timeline event güncellenemedi.' }, { status: 500 });
  }

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'case_timeline_event_updated',
    entityType: 'case_timeline_event',
    entityId: payload.eventId,
    metadata: {
      caseId: payload.caseId,
    },
  });

  return Response.json({
    event: {
      id: updateResult.data.id,
      eventType: updateResult.data.event_type,
      title: updateResult.data.title,
      description: updateResult.data.description,
      metadata: updateResult.data.metadata ?? {},
      createdBy: updateResult.data.created_by,
      createdAt: updateResult.data.created_at,
      updatedAt: updateResult.data.updated_at,
    },
  });
}

export async function DELETE(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = deleteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz timeline event silme verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  if (access.role !== 'lawyer') {
    return Response.json({ error: 'Timeline event silme için avukat yetkisi gerekir.' }, { status: 403 });
  }

  const allowed = await canAccessCase(admin, {
    caseId: payload.caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyada event silme yetkiniz yok.' }, { status: 403 });
  }

  const updateResult = await admin
    .from('case_timeline_events')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', payload.eventId)
    .eq('case_id', payload.caseId)
    .is('deleted_at', null);

  if (updateResult.error) {
    return Response.json({ error: 'Timeline event silinemedi.' }, { status: 500 });
  }

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'case_timeline_event_deleted',
    entityType: 'case_timeline_event',
    entityId: payload.eventId,
    metadata: {
      caseId: payload.caseId,
    },
  });

  return Response.json({ success: true });
}

