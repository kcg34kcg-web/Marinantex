import {
  getRecentOfficeNotificationsForAudience,
  isOfficeNotificationVisibleToAudience,
  subscribeOfficeNotifications,
} from '@/lib/office/notifications';
import { requireInternalOfficeUser } from '@/lib/office/team-access';

export async function GET() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const audience = {
    bureauId: access.bureauId,
    userId: access.userId,
  };
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const initial = getRecentOfficeNotificationsForAudience(audience, 10);
      initial.forEach((event) => {
        controller.enqueue(encoder.encode(`event: notification\ndata: ${JSON.stringify(event)}\n\n`));
      });

      unsubscribe = subscribeOfficeNotifications((event) => {
        if (!isOfficeNotificationVisibleToAudience(event, audience)) {
          return;
        }
        controller.enqueue(encoder.encode(`event: notification\ndata: ${JSON.stringify(event)}\n\n`));
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
