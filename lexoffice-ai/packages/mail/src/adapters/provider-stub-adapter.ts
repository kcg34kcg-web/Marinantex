import { randomUUID } from "node:crypto";
import type {
  DraftInput,
  GetMessageResult,
  MailProviderAdapter,
  MailboxProfile,
  MoveMessageInput,
  OAuthStartInput,
  ParseWebhookInput,
  ProviderAuthResult,
  ProviderContainer,
  ProviderMailbox,
  ProviderMessage,
  ProviderWebhookEvent,
  ProviderWebhookEventType,
  SendMessageInput,
  SyncRequest,
  SyncResult,
  WatchRequest,
  WatchResponse
} from "../types/provider-types";
import { BaseMailAdapter } from "./base-adapter";

type SupportedProvider = Exclude<MailProviderAdapter["provider"], "MANAGED">;

type StubAdapterConfig = {
  provider: SupportedProvider;
  defaultDomain: string;
  defaultScopes: string[];
  containers: ProviderContainer[];
};

export class ProviderStubAdapter extends BaseMailAdapter implements MailProviderAdapter {
  readonly provider: SupportedProvider;
  private readonly config: StubAdapterConfig;

  constructor(config: StubAdapterConfig) {
    super();
    this.config = config;
    this.provider = config.provider;
  }

  buildAuthorizationUrl(input: OAuthStartInput): string {
    const codeHint = input.loginHint?.trim().toLowerCase() || `info@${this.config.defaultDomain}`;
    const url = new URL(input.redirectUri);
    url.searchParams.set("code", codeHint);
    url.searchParams.set("state", input.state);
    return url.toString();
  }

  async connect(authCode: string, _redirectUri: string): Promise<ProviderAuthResult> {
    const fallbackEmail = `info@${this.config.defaultDomain}`;
    const email = normalizeEmailHint(authCode) ?? fallbackEmail;

    return this.buildAuthResult(email);
  }

  async refreshToken(refreshToken: string): Promise<ProviderAuthResult> {
    const fallbackEmail = `info@${this.config.defaultDomain}`;
    const email = this.readEmailFromToken(refreshToken) ?? fallbackEmail;

    return this.buildAuthResult(email);
  }

  async listMailboxes(accessToken: string): Promise<ProviderMailbox[]> {
    const email = this.readEmailFromToken(accessToken) ?? `info@${this.config.defaultDomain}`;

    return [
      {
        id: `${this.provider.toLowerCase()}-primary`,
        email,
        displayName: displayNameFromEmail(email),
        isPrimary: true
      }
    ];
  }

  async listFoldersOrLabels(
    _accessToken: string,
    _mailboxId: string
  ): Promise<ProviderContainer[]> {
    return this.config.containers;
  }

  async syncMessages(accessToken: string, request: SyncRequest): Promise<SyncResult> {
    const mailbox = this.readEmailFromToken(accessToken) ?? `info@${this.config.defaultDomain}`;
    const maxItems = Math.max(1, Math.min(request.maxResults ?? 10, 10));
    const now = Date.now();

    const messages: ProviderMessage[] = Array.from(
      { length: Math.min(3, maxItems) },
      (_, index) => {
        const sentAt = new Date(now - index * 30 * 60 * 1000);
        const safeCursor = request.cursor?.slice(0, 12) ?? "init";
        const messageId = `${this.provider.toLowerCase()}-${request.mailboxId}-${safeCursor}-${index}`;
        return {
          id: messageId,
          threadId: `${this.provider.toLowerCase()}-thread-${request.mailboxId}`,
          subject: `${this.providerLabel()} Güncellemesi #${index + 1}`,
          snippet: `Mailbox ${mailbox} için senkron mesajı ${index + 1}`,
          fromEmail: `noreply@${this.config.defaultDomain}`,
          fromName: this.providerLabel(),
          sentAt,
          receivedAt: sentAt,
          isRead: index !== 0,
          isStarred: false,
          labelsOrFolders: [this.config.containers[0]?.id ?? "INBOX"]
        };
      }
    );

    return {
      messages,
      nextCursor: new Date(now).toISOString(),
      hasMore: false
    };
  }

  async getMessage(_accessToken: string, messageId: string): Promise<GetMessageResult> {
    const now = new Date();
    return {
      id: messageId,
      threadId: `${this.provider.toLowerCase()}-thread-${messageId.split("-").at(1) ?? "default"}`,
      subject: `${this.providerLabel()} Mesaj Detayı`,
      snippet: "Mesaj detay içeriği başarıyla getirildi.",
      fromEmail: `noreply@${this.config.defaultDomain}`,
      fromName: this.providerLabel(),
      sentAt: now,
      receivedAt: now,
      isRead: false,
      isStarred: false,
      labelsOrFolders: [this.config.containers[0]?.id ?? "INBOX"],
      bodyText: `${this.providerLabel()} adapter stub mesaj içeriği.`,
      bodyHtml: `<p>${this.providerLabel()} adapter stub mesaj içeriği.</p>`
    };
  }

  async getThread(_accessToken: string, threadId: string): Promise<ProviderMessage[]> {
    const now = Date.now();
    return [
      {
        id: `${threadId}-1`,
        threadId,
        subject: `${this.providerLabel()} Thread`,
        snippet: "İlk mesaj",
        fromEmail: `noreply@${this.config.defaultDomain}`,
        fromName: this.providerLabel(),
        sentAt: new Date(now - 10 * 60 * 1000),
        receivedAt: new Date(now - 10 * 60 * 1000),
        isRead: true,
        isStarred: false,
        labelsOrFolders: [this.config.containers[0]?.id ?? "INBOX"]
      },
      {
        id: `${threadId}-2`,
        threadId,
        subject: `${this.providerLabel()} Thread`,
        snippet: "İkinci mesaj",
        fromEmail: `agent@${this.config.defaultDomain}`,
        fromName: `${this.providerLabel()} Agent`,
        sentAt: new Date(now - 5 * 60 * 1000),
        receivedAt: new Date(now - 5 * 60 * 1000),
        isRead: false,
        isStarred: false,
        labelsOrFolders: [this.config.containers[0]?.id ?? "INBOX"]
      }
    ];
  }

  async sendMessage(
    _accessToken: string,
    _input: SendMessageInput
  ): Promise<{ providerMessageId: string }> {
    return { providerMessageId: `${this.provider.toLowerCase()}-sent-${randomUUID()}` };
  }

  async createDraft(_accessToken: string, input: DraftInput): Promise<{ providerDraftId: string }> {
    return {
      providerDraftId: input.draftId ?? `${this.provider.toLowerCase()}-draft-${randomUUID()}`
    };
  }

  async updateDraft(_accessToken: string, input: DraftInput): Promise<{ providerDraftId: string }> {
    return {
      providerDraftId: input.draftId ?? `${this.provider.toLowerCase()}-draft-${randomUUID()}`
    };
  }

  async deleteMessage(_accessToken: string, _messageId: string): Promise<void> {
    return;
  }

  async archiveMessage(_accessToken: string, _messageId: string): Promise<void> {
    return;
  }

  async markRead(_accessToken: string, _messageId: string, _read: boolean): Promise<void> {
    return;
  }

  async moveMessage(_accessToken: string, _input: MoveMessageInput): Promise<void> {
    return;
  }

  async addLabel(_accessToken: string, _messageId: string, _labelId: string): Promise<void> {
    return;
  }

  async removeLabel(_accessToken: string, _messageId: string, _labelId: string): Promise<void> {
    return;
  }

  async watch(_accessToken: string, request: WatchRequest): Promise<WatchResponse> {
    return {
      watchId: `${this.provider.toLowerCase()}-watch-${request.mailboxId}-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    };
  }

  async stopWatch(_accessToken: string, _watchId: string): Promise<void> {
    return;
  }

  async getProfile(accessToken: string): Promise<MailboxProfile> {
    const email = this.readEmailFromToken(accessToken) ?? `info@${this.config.defaultDomain}`;
    return {
      email,
      displayName: displayNameFromEmail(email),
      providerAccountId: `${this.provider.toLowerCase()}-${email}`
    };
  }

  async parseWebhookEvent(input: ParseWebhookInput): Promise<ProviderWebhookEvent[]> {
    const signatureHeader =
      input.headers["x-lexoffice-signature"] ??
      input.headers["x-hub-signature-256"] ??
      input.headers["x-provider-signature"];

    this.verifyHmacSignature({
      rawBody: input.rawBody,
      ...(signatureHeader ? { signatureHeader } : {}),
      ...(input.secret ? { secret: input.secret } : {}),
      provider: this.provider
    });

    const parsed = parseJsonRecord(input.rawBody);
    if (!parsed) {
      return [];
    }

    const eventsValue = parsed.events;
    const events = Array.isArray(eventsValue) ? eventsValue : [parsed];
    const normalized: ProviderWebhookEvent[] = [];

    for (const event of events) {
      if (!event || typeof event !== "object") {
        continue;
      }

      const payload = event as Record<string, unknown>;
      const eventType = normalizeWebhookEventType(payload.eventType);
      const occurredAt = parseDate(payload.occurredAt) ?? new Date();
      const providerAccountId = readString(payload.providerAccountId);
      const mailboxEmail = readString(payload.mailboxEmail);
      const externalEventId = readString(payload.externalEventId);

      normalized.push({
        eventType,
        occurredAt,
        ...(providerAccountId ? { providerAccountId } : {}),
        ...(mailboxEmail ? { mailboxEmail } : {}),
        ...(externalEventId ? { externalEventId } : {}),
        payload
      });
    }

    return normalized;
  }

  private buildAuthResult(email: string): ProviderAuthResult {
    return {
      providerAccountId: `${this.provider.toLowerCase()}-${email}`,
      email,
      accessToken: this.issueToken("access", email),
      refreshToken: this.issueToken("refresh", email),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scopes: this.config.defaultScopes
    };
  }

  private issueToken(kind: "access" | "refresh", email: string): string {
    const encodedEmail = Buffer.from(email).toString("base64url");
    return `lx:${kind}:${this.provider}:${encodedEmail}:${randomUUID()}`;
  }

  private readEmailFromToken(token: string): string | null {
    const parts = token.split(":");
    if (parts.length < 5) {
      return null;
    }

    const encodedEmail = parts[3];
    if (!encodedEmail) {
      return null;
    }

    try {
      return Buffer.from(encodedEmail, "base64url").toString("utf-8");
    } catch {
      return null;
    }
  }

  private providerLabel(): string {
    return this.provider === "MICROSOFT_365" ? "Microsoft 365" : this.provider;
  }
}

function normalizeEmailHint(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.includes("@")) {
    return null;
  }

  return trimmed;
}

function displayNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "Mailbox";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

function normalizeWebhookEventType(value: unknown): ProviderWebhookEventType {
  if (typeof value !== "string") {
    return "UNKNOWN";
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "MESSAGE_RECEIVED") {
    return "MESSAGE_RECEIVED";
  }

  if (normalized === "MESSAGE_UPDATED") {
    return "MESSAGE_UPDATED";
  }

  if (normalized === "MAILBOX_SYNC_REQUIRED") {
    return "MAILBOX_SYNC_REQUIRED";
  }

  if (normalized === "WATCH_EXPIRED") {
    return "WATCH_EXPIRED";
  }

  return "UNKNOWN";
}
