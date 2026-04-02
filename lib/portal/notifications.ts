export type PortalNotificationCategory = 'hearings' | 'messages' | 'documents' | 'cases' | 'system';

export type PortalNotificationType =
  | 'hearing_upcoming'
  | 'case_updated'
  | 'message_received'
  | 'document_uploaded'
  | 'system_notice';

export interface PortalNotificationEvent {
  id: string;
  tenantId: string;
  userId: string | null;
  clientId: string | null;
  type: PortalNotificationType;
  category: PortalNotificationCategory;
  title: string;
  detail: string;
  actionUrl?: string;
  actionLabel?: string;
  createdAt: string;
}

const subscribers = new Set<(event: PortalNotificationEvent) => void>();
const recentEvents: PortalNotificationEvent[] = [];

function trimEvents() {
  if (recentEvents.length > 200) {
    recentEvents.splice(0, recentEvents.length - 200);
  }
}

function isVisibleToAudience(
  event: PortalNotificationEvent,
  audience: {
    tenantId: string;
    userId: string;
    clientId: string;
  },
) {
  if (event.tenantId !== audience.tenantId) {
    return false;
  }
  if (event.userId && event.userId !== audience.userId) {
    return false;
  }
  if (event.clientId && event.clientId !== audience.clientId) {
    return false;
  }
  return true;
}

export function publishPortalNotification(
  event: Omit<PortalNotificationEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): PortalNotificationEvent {
  const fullEvent: PortalNotificationEvent = {
    id: event.id ?? crypto.randomUUID(),
    createdAt: event.createdAt ?? new Date().toISOString(),
    tenantId: event.tenantId,
    userId: event.userId,
    clientId: event.clientId,
    type: event.type,
    category: event.category,
    title: event.title,
    detail: event.detail,
    actionUrl: event.actionUrl,
    actionLabel: event.actionLabel,
  };

  recentEvents.push(fullEvent);
  trimEvents();
  subscribers.forEach((handler) => handler(fullEvent));
  return fullEvent;
}

export function getRecentPortalNotificationsForAudience(
  audience: {
    tenantId: string;
    userId: string;
    clientId: string;
  },
  limit = 20,
): PortalNotificationEvent[] {
  return [...recentEvents]
    .reverse()
    .filter((item) => isVisibleToAudience(item, audience))
    .slice(0, limit);
}

export function isPortalNotificationVisibleToAudience(
  event: PortalNotificationEvent,
  audience: {
    tenantId: string;
    userId: string;
    clientId: string;
  },
) {
  return isVisibleToAudience(event, audience);
}

export function subscribePortalNotifications(handler: (event: PortalNotificationEvent) => void): () => void {
  subscribers.add(handler);
  return () => subscribers.delete(handler);
}

