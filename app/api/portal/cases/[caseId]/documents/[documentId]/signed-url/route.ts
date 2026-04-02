import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { requirePortalClientAccess, resolvePortalCaseAccess } from '@/lib/portal/access';
import { createPortalSignedDownloadToken } from '@/lib/portal/signed-link';

interface Params {
  params: Promise<{ caseId: string; documentId: string }>;
}

const pathSchema = z.object({
  caseId: z.string().uuid(),
  documentId: z.string().uuid(),
});

export async function GET(request: Request, { params }: Params) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const rawParams = await params;
  const parsedPath = pathSchema.safeParse(rawParams);
  if (!parsedPath.success) {
    return Response.json({ error: 'Geçersiz belge yolu.' }, { status: 400 });
  }

  const context = access.context;
  const { caseId, documentId } = parsedPath.data;
  const allowedCase = await resolvePortalCaseAccess({
    caseId,
    clientId: context.clientId,
    profileUserId: context.userId,
    bureauId: context.bureauId,
  });

  if (!allowedCase) {
    return Response.json({ error: 'Bu belge için erişim yetkiniz yok.' }, { status: 403 });
  }

  const admin = createAdminClient();
  const documentResult = await admin
    .from('case_documents')
    .select('id')
    .eq('id', documentId)
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .maybeSingle();

  if (documentResult.error || !documentResult.data) {
    return Response.json({ error: 'Belge bulunamadı.' }, { status: 404 });
  }

  const signed = createPortalSignedDownloadToken({
    tenantId: context.bureauId,
    userId: context.userId,
    caseId,
    documentId,
    ttlSeconds: Number(process.env.PORTAL_SIGNED_URL_TTL_SECONDS ?? 300),
  });

  const downloadPath = `/api/portal/documents/download?token=${encodeURIComponent(signed.token)}`;

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_document_signed_url_issued',
    objectType: 'case_document',
    objectId: documentId,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      caseId,
      expiresAt: signed.expiresAt,
      ttlSeconds: Number(process.env.PORTAL_SIGNED_URL_TTL_SECONDS ?? 300),
    },
  }).catch(() => undefined);

  return Response.json({
    url: downloadPath,
    expiresAt: signed.expiresAt,
  });
}

