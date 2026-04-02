import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { requirePortalClientAccess, resolvePortalCaseAccess } from '@/lib/portal/access';
import { verifyPortalSignedDownloadToken } from '@/lib/portal/signed-link';

const querySchema = z.object({
  token: z.string().min(1),
});

export async function GET(request: Request) {
  const parsedQuery = querySchema.safeParse({
    token: new URL(request.url).searchParams.get('token') ?? '',
  });

  if (!parsedQuery.success) {
    return new Response('Geçersiz indirme isteği.', { status: 400 });
  }

  const verified = verifyPortalSignedDownloadToken(parsedQuery.data.token);
  if (!verified.valid || !verified.payload) {
    return new Response('İndirme bağlantısı geçersiz veya süresi dolmuş.', { status: 401 });
  }

  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return new Response(access.message, { status: access.status });
  }

  const context = access.context;
  if (verified.payload.userId !== context.userId || verified.payload.tenantId !== context.bureauId) {
    return new Response('Bu indirme bağlantısı oturum kapsamıyla eşleşmiyor.', { status: 403 });
  }

  const allowedCase = await resolvePortalCaseAccess({
    caseId: verified.payload.caseId,
    clientId: context.clientId,
    profileUserId: context.userId,
    bureauId: context.bureauId,
  });

  if (!allowedCase) {
    return new Response('Bu belgeyi indirme yetkiniz yok.', { status: 403 });
  }

  const admin = createAdminClient();
  const documentResult = await admin
    .from('case_documents')
    .select('id, file_name, mime_type, file_size, content_base64')
    .eq('id', verified.payload.documentId)
    .eq('case_id', verified.payload.caseId)
    .is('deleted_at', null)
    .maybeSingle();

  if (documentResult.error || !documentResult.data) {
    return new Response('Belge bulunamadı.', { status: 404 });
  }

  if (!documentResult.data.content_base64) {
    return new Response('Belge içeriği mevcut değil.', { status: 410 });
  }

  const fileBuffer = Buffer.from(documentResult.data.content_base64, 'base64');

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_document_downloaded',
    objectType: 'case_document',
    objectId: verified.payload.documentId,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      caseId: verified.payload.caseId,
      fileName: documentResult.data.file_name,
      fileSize: documentResult.data.file_size,
    },
  }).catch(() => undefined);

  return new Response(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': documentResult.data.mime_type || 'application/octet-stream',
      'Content-Length': String(documentResult.data.file_size || fileBuffer.length),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(documentResult.data.file_name)}"`,
      'Cache-Control': 'private, max-age=0, no-store',
    },
  });
}

