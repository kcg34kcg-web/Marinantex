import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { canAccessCase } from '@/lib/dashboard/access';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const downloadQuerySchema = z.object({
  caseId: z.string().uuid(),
  documentId: z.string().uuid(),
});

export async function GET(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return new Response(access.message, { status: access.status });
  }

  const parsed = downloadQuerySchema.safeParse({
    caseId: new URL(request.url).searchParams.get('caseId'),
    documentId: new URL(request.url).searchParams.get('documentId'),
  });

  if (!parsed.success) {
    return new Response('Gecersiz indirme parametreleri.', { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId: payload.caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return new Response('Bu belgeyi indirme yetkiniz yok.', { status: 403 });
  }

  const documentResult = await admin
    .from('case_documents')
    .select('id, file_name, mime_type, content_base64, file_size')
    .eq('id', payload.documentId)
    .eq('case_id', payload.caseId)
    .is('deleted_at', null)
    .maybeSingle();

  if (documentResult.error || !documentResult.data) {
    return new Response('Belge bulunamadi.', { status: 404 });
  }

  if (!documentResult.data.content_base64) {
    return new Response('Belge icerigi mevcut degil.', { status: 410 });
  }

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'case_document_downloaded',
    entityType: 'case_document',
    entityId: payload.documentId,
    metadata: {
      caseId: payload.caseId,
      fileName: documentResult.data.file_name,
    },
  });

  const fileBuffer = Buffer.from(documentResult.data.content_base64, 'base64');

  return new Response(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': documentResult.data.mime_type || 'application/octet-stream',
      'Content-Length': String(documentResult.data.file_size || fileBuffer.length),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(documentResult.data.file_name)}"`,
      'Cache-Control': 'private, max-age=60',
    },
  });
}
