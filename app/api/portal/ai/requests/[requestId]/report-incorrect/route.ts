import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { requirePortalClientAccess } from '@/lib/portal/access';

interface Params {
  params: Promise<{ requestId: string }>;
}

const bodySchema = z.object({
  reason: z.string().trim().min(1).max(200),
  note: z.string().trim().max(2000).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsedBody = bodySchema.safeParse(await request.json());
  if (!parsedBody.success) {
    return Response.json({ error: 'Geçersiz geri bildirim verisi.' }, { status: 400 });
  }

  const { requestId } = await params;
  const context = access.context;
  const admin = createAdminClient();

  const existing = await admin
    .from('ai_requests')
    .select('id, metadata, user_id, tenant_id')
    .eq('id', requestId)
    .eq('user_id', context.userId)
    .eq('tenant_id', context.bureauId)
    .maybeSingle();

  if (existing.error) {
    if (existing.error.code === '42P01') {
      await writePortalAuditEvent({
        tenantId: context.bureauId,
        actorUserId: context.userId,
        eventType: 'portal_ai_summary_feedback_reported',
        objectType: 'ai_request',
        objectId: requestId,
        ipAddress: extractRequestIp(request),
        userAgent: request.headers.get('user-agent'),
        result: 'success',
        metadata: {
          reason: parsedBody.data.reason,
          note: parsedBody.data.note ?? null,
          degradedMode: true,
        },
      }).catch(() => undefined);

      return Response.json({ success: true });
    }

    return Response.json({ error: 'AI isteği doğrulanamadı.' }, { status: 500 });
  }

  if (!existing.data) {
    return Response.json({ error: 'AI isteği bulunamadı.' }, { status: 404 });
  }

  const existingMetadata =
    existing.data.metadata && typeof existing.data.metadata === 'object'
      ? (existing.data.metadata as Record<string, unknown>)
      : {};

  const updateResult = await admin
    .from('ai_requests')
    .update({
      metadata: {
        ...existingMetadata,
        feedback: {
          reportedAt: new Date().toISOString(),
          reason: parsedBody.data.reason,
          note: parsedBody.data.note ?? null,
          reportedBy: context.userId,
        },
      },
    })
    .eq('id', requestId)
    .eq('user_id', context.userId)
    .eq('tenant_id', context.bureauId);

  if (updateResult.error) {
    return Response.json({ error: 'Geri bildirim kaydedilemedi.' }, { status: 500 });
  }

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_ai_summary_feedback_reported',
    objectType: 'ai_request',
    objectId: requestId,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      reason: parsedBody.data.reason,
      note: parsedBody.data.note ?? null,
    },
  }).catch(() => undefined);

  return Response.json({ success: true });
}

