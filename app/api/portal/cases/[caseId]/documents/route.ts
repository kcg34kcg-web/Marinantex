import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { requirePortalClientAccess, resolvePortalCaseAccess } from '@/lib/portal/access';

interface Params {
  params: Promise<{ caseId: string }>;
}

const caseIdSchema = z.string().uuid();
const querySchema = z.object({
  type: z.string().trim().max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

type CaseDocumentRow = {
  id: string;
  public_ref_code: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

export async function GET(request: Request, { params }: Params) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const { caseId } = await params;
  const parsedCaseId = caseIdSchema.safeParse(caseId);
  if (!parsedCaseId.success) {
    return Response.json({ error: 'Geçersiz caseId.' }, { status: 400 });
  }

  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    type: url.searchParams.get('type') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  if (!parsedQuery.success) {
    return Response.json({ error: 'Geçersiz belge sorgusu.' }, { status: 400 });
  }

  const context = access.context;
  const allowedCase = await resolvePortalCaseAccess({
    caseId: parsedCaseId.data,
    clientId: context.clientId,
    profileUserId: context.userId,
    bureauId: context.bureauId,
  });

  if (!allowedCase) {
    return Response.json({ error: 'Bu dosyadaki belgelere erişim yetkiniz yok.' }, { status: 403 });
  }

  const admin = createAdminClient();
  let documentsQuery = admin
    .from('case_documents')
    .select('id, public_ref_code, file_name, mime_type, file_size, created_at, metadata')
    .eq('case_id', parsedCaseId.data)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(parsedQuery.data.limit);

  if (parsedQuery.data.type) {
    documentsQuery = documentsQuery.ilike('mime_type', `%${parsedQuery.data.type}%`);
  }

  if (parsedQuery.data.from) {
    documentsQuery = documentsQuery.gte('created_at', parsedQuery.data.from);
  }

  if (parsedQuery.data.to) {
    documentsQuery = documentsQuery.lte('created_at', parsedQuery.data.to);
  }

  const documentsResult = await documentsQuery;
  if (documentsResult.error) {
    return Response.json({ error: 'Belge listesi alınamadı.' }, { status: 500 });
  }

  const rows = (documentsResult.data ?? []) as CaseDocumentRow[];
  const documentIds = rows.map((row) => row.id);
  const versionsResult = documentIds.length
    ? await admin
        .from('document_versions')
        .select('document_id, version_no, created_at')
        .in('document_id', documentIds)
    : { data: [], error: null };

  const versionCountByDocumentId = new Map<string, number>();
  if (!versionsResult.error) {
    (versionsResult.data ?? []).forEach((item) => {
      const current = versionCountByDocumentId.get(item.document_id) ?? 0;
      versionCountByDocumentId.set(item.document_id, current + 1);
    });
  }

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_case_documents_viewed',
    objectType: 'case',
    objectId: parsedCaseId.data,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      itemCount: rows.length,
      filteredByType: parsedQuery.data.type ?? null,
    },
  }).catch(() => undefined);

  return Response.json({
    items: rows.map((item) => ({
      id: item.id,
      publicRefCode: item.public_ref_code,
      fileName: item.file_name,
      mimeType: item.mime_type,
      fileSize: item.file_size,
      createdAt: item.created_at,
      versionCount: versionCountByDocumentId.get(item.id) ?? 0,
      metadata: item.metadata ?? {},
      signedUrlPath: `/api/portal/cases/${parsedCaseId.data}/documents/${item.id}/signed-url`,
    })),
  });
}

