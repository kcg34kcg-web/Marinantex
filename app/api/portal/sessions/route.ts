import { cookies } from 'next/headers';
import { z } from 'zod';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { requirePortalClientAccess } from '@/lib/portal/access';
import {
  getPortalSessionCookies,
  listPortalSessions,
  revokePortalSessionsExcept,
} from '@/lib/portal/session';

const revokeOthersSchema = z.object({
  keepSessionId: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const context = access.context;
  const cookieStore = await cookies();
  const cookieSessionId = getPortalSessionCookies(cookieStore).sessionId;
  const currentSessionId = context.sessionId ?? cookieSessionId ?? null;
  const sessions = await listPortalSessions({
    userId: context.userId,
    tenantId: context.bureauId,
  });

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_sessions_list_viewed',
    objectType: 'session_collection',
    objectId: null,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      itemCount: sessions.length,
      currentSessionId,
    },
  }).catch(() => undefined);

  return Response.json({
    currentSessionId,
    items: sessions.map((item) => ({
      ...item,
      isCurrent: currentSessionId ? item.id === currentSessionId : false,
    })),
  });
}

export async function DELETE(request: Request) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const payload = revokeOthersSchema.safeParse(await request.json().catch(() => ({})));
  if (!payload.success) {
    return Response.json({ error: 'Geçersiz oturum iptal verisi.' }, { status: 400 });
  }

  const context = access.context;
  const cookieStore = await cookies();
  const fallbackSessionId = getPortalSessionCookies(cookieStore).sessionId;
  const keepSessionId = payload.data.keepSessionId ?? context.sessionId ?? fallbackSessionId ?? null;

  if (!keepSessionId) {
    return Response.json({ error: 'Aktif oturum tespit edilemedi.' }, { status: 400 });
  }

  await revokePortalSessionsExcept({
    sessionIdToKeep: keepSessionId,
    userId: context.userId,
    tenantId: context.bureauId,
    reason: 'revoke_others',
  });

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_sessions_revoked_other_devices',
    objectType: 'session',
    objectId: keepSessionId,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      keptSessionId: keepSessionId,
    },
  }).catch(() => undefined);

  return Response.json({ success: true, keptSessionId: keepSessionId });
}

