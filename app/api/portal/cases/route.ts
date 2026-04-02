import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { listPortalAccessibleCases, requirePortalClientAccess } from '@/lib/portal/access';

export async function GET(request: Request) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const { bureauId, clientId, userId } = access.context;
  let items = [];

  try {
    items = await listPortalAccessibleCases({
      bureauId,
      clientId,
      profileUserId: userId,
    });
  } catch {
    return Response.json({ error: 'Dosya listesi alınamadı.' }, { status: 500 });
  }

  await writePortalAuditEvent({
    tenantId: bureauId,
    actorUserId: userId,
    eventType: 'portal_case_list_viewed',
    objectType: 'case_collection',
    objectId: null,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      itemCount: items.length,
    },
  }).catch(() => undefined);

  return Response.json({
    items,
    total: items.length,
  });
}
