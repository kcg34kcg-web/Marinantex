import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { listPortalAccessibleCases, requirePortalClientAccess } from '@/lib/portal/access';

const querySchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: Request) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = querySchema.safeParse({
    q: new URL(request.url).searchParams.get('q') ?? '',
    limit: new URL(request.url).searchParams.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz arama sorgusu.' }, { status: 400 });
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
    return Response.json({ error: 'Arama kapsamı doğrulanamadı.' }, { status: 500 });
  }

  const caseIds = accessibleCases.map((item) => item.id);
  const query = `%${parsed.data.q}%`;
  const admin = createAdminClient();

  const matchingCases = accessibleCases
    .filter((item) => item.title.toLowerCase().includes(parsed.data.q.toLowerCase()))
    .slice(0, parsed.data.limit)
    .map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      updatedAt: item.updatedAt,
    }));

  const [documentsResult, messagesResult] = caseIds.length
    ? await Promise.all([
        admin
          .from('case_documents')
          .select('id, case_id, file_name, mime_type, created_at')
          .in('case_id', caseIds)
          .is('deleted_at', null)
          .ilike('file_name', query)
          .order('created_at', { ascending: false })
          .limit(parsed.data.limit),
        admin
          .from('portal_case_messages')
          .select('id, case_id, body, created_at, sender_user_id')
          .eq('tenant_id', context.bureauId)
          .eq('client_id', context.clientId)
          .ilike('body', query)
          .order('created_at', { ascending: false })
          .limit(parsed.data.limit),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  const caseTitleById = new Map(accessibleCases.map((item) => [item.id, item.title]));
  const messageRows =
    messagesResult.error && messagesResult.error.code === '42P01' ? [] : (messagesResult.data ?? []);

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_search_executed',
    objectType: 'search_query',
    objectId: null,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      query: parsed.data.q,
      caseHits: matchingCases.length,
      documentHits: documentsResult.error ? 0 : (documentsResult.data ?? []).length,
      messageHits: messageRows.length,
    },
  }).catch(() => undefined);

  return Response.json({
    query: parsed.data.q,
    cases: matchingCases,
    documents: documentsResult.error
      ? []
      : (documentsResult.data ?? []).map((item) => ({
          id: item.id,
          caseId: item.case_id,
          caseTitle: caseTitleById.get(item.case_id) ?? 'Dosya',
          fileName: item.file_name,
          mimeType: item.mime_type,
          createdAt: item.created_at,
        })),
    messages: messageRows.map((item) => ({
      id: item.id,
      caseId: item.case_id,
      caseTitle: caseTitleById.get(item.case_id) ?? 'Dosya',
      snippet: item.body.slice(0, 220),
      senderUserId: item.sender_user_id,
      createdAt: item.created_at,
    })),
  });
}

