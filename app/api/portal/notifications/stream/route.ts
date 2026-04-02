import { createAdminClient } from '@/utils/supabase/admin';
import { requirePortalClientAccess } from '@/lib/portal/access';
import {
  getRecentPortalNotificationsForAudience,
  isPortalNotificationVisibleToAudience,
  subscribePortalNotifications,
} from '@/lib/portal/notifications';

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

async function loadPersistedNotifications(input: {
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
  }));
}

export async function GET() {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const audience = {
    tenantId: access.context.bureauId,
    userId: access.context.userId,
    clientId: access.context.clientId,
  };
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const [memory, persisted] = await Promise.all([
        Promise.resolve(getRecentPortalNotificationsForAudience(audience, 10)),
        loadPersistedNotifications({
          tenantId: audience.tenantId,
          userId: audience.userId,
          limit: 10,
        }),
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
          });
        }
      });

      [...map.values()]
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .forEach((event) => {
          controller.enqueue(encoder.encode(`event: notification\ndata: ${JSON.stringify(event)}\n\n`));
        });

      unsubscribe = subscribePortalNotifications((event) => {
        if (!isPortalNotificationVisibleToAudience(event, audience)) {
          return;
        }
        controller.enqueue(
          encoder.encode(
            `event: notification\ndata: ${JSON.stringify({
              ...event,
              isRead: false,
            })}\n\n`,
          ),
        );
      });

      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 15000);
    },
    cancel() {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      if (unsubscribe) {
        unsubscribe();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

