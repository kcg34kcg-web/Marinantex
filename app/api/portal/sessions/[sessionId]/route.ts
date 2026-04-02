import { cookies } from 'next/headers';
import { z } from 'zod';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { requirePortalClientAccess } from '@/lib/portal/access';
import {
  clearPortalSessionCookies,
  getPortalSessionCookies,
  revokePortalSessionById,
} from '@/lib/portal/session';

interface Params {
  params: Promise<{ sessionId: string }>;
}

const sessionPathSchema = z.object({
  sessionId: z.string().uuid(),
});

export async function DELETE(request: Request, { params }: Params) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsedPath = sessionPathSchema.safeParse(await params);
  if (!parsedPath.success) {
    return Response.json({ error: 'Geçersiz sessionId.' }, { status: 400 });
  }

  const targetSessionId = parsedPath.data.sessionId;
  const context = access.context;
  const cookieStore = await cookies();
  const cookieSessionId = getPortalSessionCookies(cookieStore).sessionId;
  const currentSessionId = context.sessionId ?? cookieSessionId ?? null;
  const isCurrentSession = currentSessionId === targetSessionId;

  await revokePortalSessionById({
    sessionId: targetSessionId,
    userId: context.userId,
    tenantId: context.bureauId,
    reason: isCurrentSession ? 'self_logout' : 'device_revoked_by_user',
  });

  if (isCurrentSession) {
    clearPortalSessionCookies(cookieStore);
  }

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_session_revoked',
    objectType: 'session',
    objectId: targetSessionId,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      isCurrentSession,
    },
  }).catch(() => undefined);

  return Response.json({
    success: true,
    revokedSessionId: targetSessionId,
    revokedCurrentSession: isCurrentSession,
  });
}

