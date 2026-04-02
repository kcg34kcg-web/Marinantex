type OfficeNotificationType = 'document_uploaded' | 'risk_communication' | 'deadline_confirmed';
type OfficeNotificationCategory = 'hearings' | 'messages' | 'tasks' | 'documents';

export interface OfficeNotification {
  id: string;
  type: OfficeNotificationType;
  category: OfficeNotificationCategory;
  title: string;
  detail: string;
  actionUrl?: string;
  actionLabel?: string;
  bureauId?: string;
  recipientUserIds?: string[];
  createdAt: string;
}

const subscribers = new Set<(event: OfficeNotification) => void>();
const recentEvents: OfficeNotification[] = [];

function trimEvents() {
  if (recentEvents.length > 100) {
    recentEvents.splice(0, recentEvents.length - 100);
  }
}

export function publishOfficeNotification(event: Omit<OfficeNotification, 'id' | 'createdAt'>): OfficeNotification {
  const fullEvent: OfficeNotification = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...event,
  };

  recentEvents.push(fullEvent);
  trimEvents();

  subscribers.forEach((handler) => handler(fullEvent));

  return fullEvent;
}

function isVisibleToAudience(
  event: OfficeNotification,
  audience: {
    bureauId: string;
    userId: string;
  },
) {
  if (!event.bureauId || event.bureauId !== audience.bureauId) {
    return false;
  }

  if (event.recipientUserIds && event.recipientUserIds.length > 0) {
    return event.recipientUserIds.includes(audience.userId);
  }

  return true;
}

export function getRecentOfficeNotificationsForAudience(
  audience: {
    bureauId: string;
    userId: string;
  },
  limit = 10,
): OfficeNotification[] {
  return [...recentEvents]
    .reverse()
    .filter((event) => isVisibleToAudience(event, audience))
    .slice(0, limit);
}

export function isOfficeNotificationVisibleToAudience(
  event: OfficeNotification,
  audience: {
    bureauId: string;
    userId: string;
  },
): boolean {
  return isVisibleToAudience(event, audience);
}

export function subscribeOfficeNotifications(handler: (event: OfficeNotification) => void): () => void {
  subscribers.add(handler);
  return () => subscribers.delete(handler);
}
