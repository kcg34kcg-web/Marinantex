import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { requirePortalClientAccess, resolvePortalCaseAccess } from '@/lib/portal/access';

interface Params {
  params: Promise<{ caseId: string }>;
}

const caseIdSchema = z.string().uuid();
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

type TimelineItem = {
  id: string;
  source: 'timeline_event' | 'case_update';
  eventType: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
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

  const parsedQuery = querySchema.safeParse({
    limit: new URL(request.url).searchParams.get('limit') ?? undefined,
  });

  if (!parsedQuery.success) {
    return Response.json({ error: 'Geçersiz timeline sorgusu.' }, { status: 400 });
  }

  const context = access.context;
  const allowedCase = await resolvePortalCaseAccess({
    caseId: parsedCaseId.data,
    clientId: context.clientId,
    profileUserId: context.userId,
    bureauId: context.bureauId,
  });

  if (!allowedCase) {
    return Response.json({ error: 'Bu dosyanın timeline verisine erişim yetkiniz yok.' }, { status: 403 });
  }

  const admin = createAdminClient();
  const [timelineResult, caseUpdatesResult] = await Promise.all([
    admin
      .from('case_timeline_events')
      .select('id, event_type, title, description, metadata, created_at')
      .eq('case_id', parsedCaseId.data)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(parsedQuery.data.limit),
    admin
      .from('case_updates')
      .select('id, message, date')
      .eq('case_id', parsedCaseId.data)
      .eq('is_public_to_client', true)
      .order('date', { ascending: false })
      .limit(parsedQuery.data.limit),
  ]);

  const timelineItems: TimelineItem[] = [];

  if (!timelineResult.error) {
    (timelineResult.data ?? []).forEach((item) => {
      timelineItems.push({
        id: item.id,
        source: 'timeline_event',
        eventType: item.event_type,
        title: item.title,
        description: item.description,
        metadata: (item.metadata ?? {}) as Record<string, unknown>,
        createdAt: item.created_at,
      });
    });
  }

  if (!caseUpdatesResult.error) {
    (caseUpdatesResult.data ?? []).forEach((item) => {
      timelineItems.push({
        id: item.id,
        source: 'case_update',
        eventType: 'public_update',
        title: 'Dosya güncellemesi',
        description: item.message,
        metadata: {},
        createdAt: item.date,
      });
    });
  }

  const sorted = timelineItems
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, parsedQuery.data.limit);

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_case_timeline_viewed',
    objectType: 'case',
    objectId: parsedCaseId.data,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      itemCount: sorted.length,
    },
  }).catch(() => undefined);

  return Response.json({
    items: sorted,
  });
}

