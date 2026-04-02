import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { requirePortalClientAccess, resolvePortalCaseAccess } from '@/lib/portal/access';

interface Params {
  params: Promise<{ caseId: string }>;
}

const caseIdSchema = z.string().uuid();
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

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

  const parsedQuery = querySchema.safeParse({
    limit: new URL(request.url).searchParams.get('limit') ?? undefined,
  });
  if (!parsedQuery.success) {
    return Response.json({ error: 'Geçersiz mesaj sorgusu.' }, { status: 400 });
  }

  const context = access.context;
  const allowedCase = await resolvePortalCaseAccess({
    caseId: parsedCaseId.data,
    clientId: context.clientId,
    profileUserId: context.userId,
    bureauId: context.bureauId,
  });

  if (!allowedCase) {
    return Response.json({ error: 'Bu dosyadaki mesajlara erişim yetkiniz yok.' }, { status: 403 });
  }

  const admin = createAdminClient();
  const result = await admin
    .from('portal_case_messages')
    .select('id, sender_user_id, body, metadata, created_at')
    .eq('tenant_id', context.bureauId)
    .eq('case_id', parsedCaseId.data)
    .eq('client_id', context.clientId)
    .order('created_at', { ascending: false })
    .limit(parsedQuery.data.limit);

  if (result.error && result.error.code !== '42P01') {
    return Response.json({ error: 'Mesaj geçmişi alınamadı.' }, { status: 500 });
  }

  const messages = (result.data ?? []).map((item) => ({
    id: item.id,
    senderUserId: item.sender_user_id,
    body: item.body,
    metadata: item.metadata ?? {},
    createdAt: item.created_at,
    isOwnMessage: item.sender_user_id === context.userId,
  }));

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_case_messages_viewed',
    objectType: 'case',
    objectId: parsedCaseId.data,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      itemCount: messages.length,
    },
  }).catch(() => undefined);

  return Response.json({
    items: messages,
  });
}

