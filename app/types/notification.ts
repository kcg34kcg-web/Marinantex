export type NotificationType = 'like' | 'comment' | 'reply' | 'follow' | 'system';

export interface NotificationActor {
  id?: string;
  username?: string | null;
  avatar_url?: string | null;
}

export interface Notification {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  type: NotificationType;
  title?: string | null;
  body?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  is_read: boolean;
  created_at: string;
  actor?: NotificationActor | null;
}

