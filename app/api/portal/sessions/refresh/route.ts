import { cookies } from 'next/headers';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { requirePortalClientAccess } from '@/lib/portal/access';
import {
  getPortalSessionCookies,
  rotatePortalRefreshSession,
  setPortalSessionCookies,
} from '@/lib/portal/session';

export async function POST(request: Request) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const cookieStore = await cookies();
  const sessionCookies = getPortalSessionCookies(cookieStore);
  if (!sessionCookies.refreshToken) {
    return Response.json({ error: 'Yenileme tokenı bulunamadı.' }, { status: 401 });
  }

  const context = access.context;
  const rotated = await rotatePortalRefreshSession({
    refreshToken: sessionCookies.refreshToken,
    expectedUserId: context.userId,
    expectedTenantId: context.bureauId,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
  });

  if (!rotated) {
    return Response.json({ error: 'Oturum yenilenemedi. Tekrar giriş yapın.' }, { status: 401 });
  }

  setPortalSessionCookies(cookieStore, {
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken,
    sessionId: rotated.sessionId,
    deviceId: rotated.deviceId,
  });

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_session_refreshed',
    objectType: 'session',
    objectId: rotated.sessionId,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      deviceId: rotated.deviceId,
      persisted: rotated.persisted,
      accessExpiresAt: rotated.accessExpiresAt,
      refreshExpiresAt: rotated.refreshExpiresAt,
    },
  }).catch(() => undefined);

  return Response.json({
    sessionId: rotated.sessionId,
    deviceId: rotated.deviceId,
    accessExpiresAt: rotated.accessExpiresAt,
    refreshExpiresAt: rotated.refreshExpiresAt,
    persisted: rotated.persisted,
  });
}

