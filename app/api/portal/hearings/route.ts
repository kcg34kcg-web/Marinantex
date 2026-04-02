import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { listPortalAccessibleCases, requirePortalClientAccess, resolvePortalCaseAccess } from '@/lib/portal/access';
import { buildGoogleCalendarLink, detectHearingScheduledAt, isHearingLike } from '@/lib/portal/hearing-calendar';

const querySchema = z.object({
  caseId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(120).default(20),
});

interface HearingTimelineRow {
  id: string;
  case_id: string;
  event_type: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function GET(request: Request) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    caseId: url.searchParams.get('caseId') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  if (!parsedQuery.success) {
    return Response.json({ error: 'Geçersiz duruşma sorgusu.' }, { status: 400 });
  }

  const context = access.context;
  const { caseId, from, to, limit } = parsedQuery.data;

  if (caseId) {
    const allowedCase = await resolvePortalCaseAccess({
      caseId,
      clientId: context.clientId,
      profileUserId: context.userId,
      bureauId: context.bureauId,
    });

    if (!allowedCase) {
      return Response.json({ error: 'Bu dosyanın duruşmalarına erişim yetkiniz yok.' }, { status: 403 });
    }
  }

  const accessibleCases = await listPortalAccessibleCases({
    bureauId: context.bureauId,
    clientId: context.clientId,
    profileUserId: context.userId,
  });

  const filteredCases = caseId ? accessibleCases.filter((item) => item.id === caseId) : accessibleCases;
  const caseIds = filteredCases.map((item) => item.id);
  if (caseIds.length === 0) {
    return Response.json({ items: [] });
  }

  const caseById = new Map(filteredCases.map((item) => [item.id, item]));
  const admin = createAdminClient();
  const timelineResult = await admin
    .from('case_timeline_events')
    .select('id, case_id, event_type, title, description, metadata, created_at')
    .in('case_id', caseIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(600);

  if (timelineResult.error) {
    return Response.json({ error: 'Duruşma takvimi alınamadı.' }, { status: 500 });
  }

  const fromTime = from ? new Date(from).getTime() : null;
  const toTime = to ? new Date(to).getTime() : null;

  const hearings = ((timelineResult.data ?? []) as HearingTimelineRow[])
    .filter((item) =>
      isHearingLike({
        eventType: item.event_type,
        title: item.title,
        metadata: item.metadata,
      }),
    )
    .map((item) => {
      const scheduledAt = detectHearingScheduledAt(item.metadata) ?? item.created_at;
      const scheduledTime = new Date(scheduledAt).getTime();
      if (Number.isNaN(scheduledTime)) {
        return null;
      }

      if (fromTime !== null && scheduledTime < fromTime) {
        return null;
      }
      if (toTime !== null && scheduledTime > toTime) {
        return null;
      }

      const linkedCase = caseById.get(item.case_id);
      if (!linkedCase) {
        return null;
      }

      const location =
        typeof item.metadata?.courtName === 'string'
          ? item.metadata.courtName
          : typeof item.metadata?.location === 'string'
            ? item.metadata.location
            : null;
      const details = [linkedCase.title, item.description].filter(Boolean).join('\n\n');
      const googleCalendarUrl = buildGoogleCalendarLink({
        title: item.title || `${linkedCase.title} - Duruşma`,
        description: details,
        startIso: scheduledAt,
        location,
      });

      return {
        id: item.id,
        caseId: item.case_id,
        caseTitle: linkedCase.title,
        caseFileNo: linkedCase.fileNo,
        title: item.title,
        description: item.description,
        scheduledAt,
        eventType: item.event_type,
        location,
        source: 'timeline_event' as const,
        googleCalendarUrl,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime())
    .slice(0, limit);

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_hearing_calendar_viewed',
    objectType: 'hearing_collection',
    objectId: null,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      itemCount: hearings.length,
      caseId: caseId ?? null,
    },
  }).catch(() => undefined);

  return Response.json({
    items: hearings,
  });
}

