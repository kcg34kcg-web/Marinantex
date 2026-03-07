export type ProviderAuthResult = {
  providerAccountId: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
};

export type OAuthStartInput = {
  redirectUri: string;
  state: string;
  loginHint?: string;
};

export type MailboxProfile = {
  email: string;
  displayName?: string;
  providerAccountId: string;
};

export type ProviderMailbox = {
  id: string;
  email: string;
  displayName?: string;
  isPrimary: boolean;
};

export type ProviderContainer = {
  id: string;
  name: string;
  type: "label" | "folder" | "system";
  parentId?: string;
};

export type SyncRequest = {
  mailboxId: string;
  cursor?: string;
  maxResults?: number;
};

export type ProviderMessage = {
  id: string;
  threadId: string;
  subject?: string;
  snippet?: string;
  fromEmail: string;
  fromName?: string;
  sentAt?: Date;
  receivedAt?: Date;
  isRead: boolean;
  isStarred: boolean;
  labelsOrFolders: string[];
};

export type SyncResult = {
  messages: ProviderMessage[];
  nextCursor?: string;
  hasMore: boolean;
};

export type GetMessageResult = ProviderMessage & {
  bodyText?: string;
  bodyHtml?: string;
};

export type SendMessageInput = {
  mailboxId: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  inReplyToMessageId?: string;
  attachments?: Array<{
    name: string;
    contentBase64: string;
    mimeType: string;
  }>;
};

export type DraftInput = SendMessageInput & {
  draftId?: string;
};

export type MoveMessageInput = {
  messageId: string;
  targetContainerId: string;
};

export type WatchRequest = {
  mailboxId: string;
  webhookUrl: string;
};

export type WatchResponse = {
  watchId: string;
  expiresAt?: Date;
};

export type ParseWebhookInput = {
  rawBody: string;
  headers: Record<string, string | undefined>;
  secret?: string;
};

export type ProviderWebhookEventType =
  | "MESSAGE_RECEIVED"
  | "MESSAGE_UPDATED"
  | "MAILBOX_SYNC_REQUIRED"
  | "WATCH_EXPIRED"
  | "UNKNOWN";

export type ProviderWebhookEvent = {
  providerAccountId?: string;
  mailboxEmail?: string;
  eventType: ProviderWebhookEventType;
  occurredAt: Date;
  externalEventId?: string;
  payload?: Record<string, unknown>;
};

export interface MailProviderAdapter {
  readonly provider: "GMAIL" | "MICROSOFT_365" | "YANDEX" | "IMAP_SMTP";

  buildAuthorizationUrl(input: OAuthStartInput): string;
  connect(authCode: string, redirectUri: string): Promise<ProviderAuthResult>;
  refreshToken(refreshToken: string): Promise<ProviderAuthResult>;
  listMailboxes(accessToken: string): Promise<ProviderMailbox[]>;
  listFoldersOrLabels(accessToken: string, mailboxId: string): Promise<ProviderContainer[]>;
  syncMessages(accessToken: string, request: SyncRequest): Promise<SyncResult>;
  getMessage(accessToken: string, messageId: string): Promise<GetMessageResult>;
  getThread(accessToken: string, threadId: string): Promise<ProviderMessage[]>;
  sendMessage(accessToken: string, input: SendMessageInput): Promise<{ providerMessageId: string }>;
  createDraft(accessToken: string, input: DraftInput): Promise<{ providerDraftId: string }>;
  updateDraft(accessToken: string, input: DraftInput): Promise<{ providerDraftId: string }>;
  deleteMessage(accessToken: string, messageId: string): Promise<void>;
  archiveMessage(accessToken: string, messageId: string): Promise<void>;
  markRead(accessToken: string, messageId: string, read: boolean): Promise<void>;
  moveMessage(accessToken: string, input: MoveMessageInput): Promise<void>;
  addLabel(accessToken: string, messageId: string, labelId: string): Promise<void>;
  removeLabel(accessToken: string, messageId: string, labelId: string): Promise<void>;
  watch(accessToken: string, request: WatchRequest): Promise<WatchResponse>;
  stopWatch(accessToken: string, watchId: string): Promise<void>;
  getProfile(accessToken: string): Promise<MailboxProfile>;
  parseWebhookEvent(input: ParseWebhookInput): Promise<ProviderWebhookEvent[]>;
}
