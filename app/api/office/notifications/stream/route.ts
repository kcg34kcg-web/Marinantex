import { getRecentOfficeNotifications, subscribeOfficeNotifications } from '@/lib/office/notifications';

export async function GET() {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const initial = getRecentOfficeNotifications().slice(0, 10);
      initial.forEach((event) => {
        controller.enqueue(encoder.encode(`event: notification\ndata: ${JSON.stringify(event)}\n\n`));
      });

      unsubscribe = subscribeOfficeNotifications((event) => {
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
