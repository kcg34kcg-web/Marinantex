import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { requirePortalClientAccess } from '@/lib/portal/access';
import { getRecentPortalNotificationsForAudience } from '@/lib/portal/notifications';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const markReadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

interface PersistedNotificationRow {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
  is_read: boolean;
}

function inferCategory(input: {
  type: string;
  title: string | null;
  resourceType: string | null;
}): 'hearings' | 'messages' | 'documents' | 'cases' | 'system' {
  const normalized = `${input.type} ${input.title ?? ''} ${input.resourceType ?? ''}`.toLowerCase();
  if (normalized.includes('duruşma') || normalized.includes('durusma') || normalized.includes('hearing')) {
    return 'hearings';
  }
  if (normalized.includes('message') || normalized.includes('mesaj')) {
    return 'messages';
  }
  if (normalized.includes('document') || normalized.includes('belge')) {
    return 'documents';
  }
  if (normalized.includes('case') || normalized.includes('dosya')) {
    return 'cases';
  }
  return 'system';
}

function inferType(input: {
  type: string;
  title: string | null;
  resourceType: string | null;
}): 'hearing_upcoming' | 'case_updated' | 'message_received' | 'document_uploaded' | 'system_notice' {
  const category = inferCategory(input);
  if (category === 'hearings') return 'hearing_upcoming';
  if (category === 'messages') return 'message_received';
  if (category === 'documents') return 'document_uploaded';
  if (category === 'cases') return 'case_updated';
  return 'system_notice';
}

async function loadPersistedPortalNotifications(input: {
  tenantId: string;
  userId: string;
  limit: number;
}) {
  const admin = createAdminClient();
  const baseSelect = 'id, type, title, body, resource_type, resource_id, created_at, is_read';

  const withTenantResult = await admin
    .from('notifications')
    .select(`${baseSelect}, tenant_id`)
    .eq('recipient_id', input.userId)
    .eq('tenant_id', input.tenantId)
    .order('created_at', { ascending: false })
    .limit(input.limit);

  const result =
    withTenantResult.error?.code === '42703'
      ? await admin
          .from('notifications')
          .select(baseSelect)
          .eq('recipient_id', input.userId)
          .order('created_at', { ascending: false })
          .limit(input.limit)
      : withTenantResult;

  if (result.error) {
    return [];
  }

  return ((result.data ?? []) as PersistedNotificationRow[]).map((item) => ({
    id: item.id,
    type: inferType({
      type: item.type,
      title: item.title,
      resourceType: item.resource_type,
    }),
    category: inferCategory({
      type: item.type,
      title: item.title,
      resourceType: item.resource_type,
    }),
    title: item.title ?? 'Portal bildirimi',
    detail: item.body ?? '',
    actionUrl: item.resource_id ? `/portal/cases/${item.resource_id}` : undefined,
    actionLabel: item.resource_id ? 'Dosyayı Aç' : undefined,
    createdAt: item.created_at,
    isRead: item.is_read,
    source: 'db' as const,
  }));
}

export async function GET(request: Request) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsedQuery = querySchema.safeParse({
    limit: new URL(request.url).searchParams.get('limit') ?? undefined,
  });

  if (!parsedQuery.success) {
    return Response.json({ error: 'Geçersiz bildirim sorgusu.' }, { status: 400 });
  }

  const context = access.context;
  const limit = parsedQuery.data.limit;

  const [persisted, memory] = await Promise.all([
    loadPersistedPortalNotifications({
      tenantId: context.bureauId,
      userId: context.userId,
      limit,
    }),
    Promise.resolve(
      getRecentPortalNotificationsForAudience(
        {
          tenantId: context.bureauId,
          userId: context.userId,
          clientId: context.clientId,
        },
        limit,
      ),
    ),
  ]);

  const map = new Map<string, (typeof persisted)[number]>();
  persisted.forEach((item) => map.set(item.id, item));
  memory.forEach((item) => {
    if (!map.has(item.id)) {
      map.set(item.id, {
        id: item.id,
        type: item.type,
        category: item.category,
        title: item.title,
        detail: item.detail,
        actionUrl: item.actionUrl,
        actionLabel: item.actionLabel,
        createdAt: item.createdAt,
        isRead: false,
        source: 'memory',
      });
    }
  });

  const items = [...map.values()]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_notifications_list_viewed',
    objectType: 'notification_collection',
    objectId: null,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      itemCount: items.length,
    },
  }).catch(() => undefined);

  return Response.json({ items });
}

export async function POST(request: Request) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsedBody = markReadSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) {
    return Response.json({ error: 'Geçersiz bildirim okundu verisi.' }, { status: 400 });
  }

  const context = access.context;
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const withTenantResult = await admin
    .from('notifications')
    .update({
      is_read: true,
      read_at: nowIso,
    })
    .eq('recipient_id', context.userId)
    .eq('tenant_id', context.bureauId)
    .in('id', parsedBody.data.ids);

  const result =
    withTenantResult.error?.code === '42703'
      ? await admin
          .from('notifications')
          .update({
            is_read: true,
          })
          .eq('recipient_id', context.userId)
          .in('id', parsedBody.data.ids)
      : withTenantResult;

  if (result.error) {
    return Response.json({ error: 'Bildirimler güncellenemedi.' }, { status: 500 });
  }

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_notifications_marked_read',
    objectType: 'notification_collection',
    objectId: null,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      notificationIds: parsedBody.data.ids,
    },
  }).catch(() => undefined);

  return Response.json({
    success: true,
    markedCount: parsedBody.data.ids.length,
  });
}

