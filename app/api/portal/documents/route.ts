import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { listPortalAccessibleCases, requirePortalClientAccess } from '@/lib/portal/access';

const querySchema = z.object({
  caseId: z.string().uuid().optional(),
  type: z.string().trim().max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

type DocumentRow = {
  id: string;
  case_id: string;
  public_ref_code: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

export async function GET(request: Request) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = querySchema.safeParse({
    caseId: new URL(request.url).searchParams.get('caseId') ?? undefined,
    type: new URL(request.url).searchParams.get('type') ?? undefined,
    from: new URL(request.url).searchParams.get('from') ?? undefined,
    to: new URL(request.url).searchParams.get('to') ?? undefined,
    limit: new URL(request.url).searchParams.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz belge filtresi.' }, { status: 400 });
  }

  const context = access.context;
  let accessibleCases;
  try {
    accessibleCases = await listPortalAccessibleCases({
      bureauId: context.bureauId,
      clientId: context.clientId,
      profileUserId: context.userId,
    });
  } catch {
    return Response.json({ error: 'Dosya kapsamı doğrulanamadı.' }, { status: 500 });
  }

  const caseIds = accessibleCases.map((item) => item.id);
  if (caseIds.length === 0) {
    return Response.json({ items: [] });
  }

  if (parsed.data.caseId && !caseIds.includes(parsed.data.caseId)) {
    return Response.json({ error: 'Bu dosyadaki belgelere erişim yetkiniz yok.' }, { status: 403 });
  }

  const admin = createAdminClient();
  let query = admin
    .from('case_documents')
    .select('id, case_id, public_ref_code, file_name, mime_type, file_size, created_at, metadata')
    .in('case_id', parsed.data.caseId ? [parsed.data.caseId] : caseIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(parsed.data.limit);

  if (parsed.data.type) {
    query = query.ilike('mime_type', `%${parsed.data.type}%`);
  }
  if (parsed.data.from) {
    query = query.gte('created_at', parsed.data.from);
  }
  if (parsed.data.to) {
    query = query.lte('created_at', parsed.data.to);
  }

  const result = await query;
  if (result.error) {
    return Response.json({ error: 'Belge listesi alınamadı.' }, { status: 500 });
  }

  const caseTitleById = new Map(accessibleCases.map((item) => [item.id, item.title]));
  const rows = (result.data ?? []) as DocumentRow[];

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_documents_viewed',
    objectType: 'document_collection',
    objectId: parsed.data.caseId ?? null,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      itemCount: rows.length,
      caseFilter: parsed.data.caseId ?? null,
      typeFilter: parsed.data.type ?? null,
    },
  }).catch(() => undefined);

  return Response.json({
    items: rows.map((item) => ({
      id: item.id,
      caseId: item.case_id,
      caseTitle: caseTitleById.get(item.case_id) ?? 'Dosya',
      publicRefCode: item.public_ref_code,
      fileName: item.file_name,
      mimeType: item.mime_type,
      fileSize: item.file_size,
      createdAt: item.created_at,
      metadata: item.metadata ?? {},
      signedUrlPath: `/api/portal/cases/${item.case_id}/documents/${item.id}/signed-url`,
    })),
  });
}

