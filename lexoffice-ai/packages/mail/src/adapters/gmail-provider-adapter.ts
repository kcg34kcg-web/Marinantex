import { ProviderError } from "../types/errors";
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
  SendMessageInput,
  SyncRequest,
  SyncResult,
  WatchRequest,
  WatchResponse
} from "../types/provider-types";
import { BaseMailAdapter } from "./base-adapter";
import {
  asArray,
  asString,
  decodeBase64UrlToString,
  decodeJwtPayload,
  expiresAtFromNow,
  hasValue,
  isLiveProviderEnabled,
  makeDeterministicExternalId,
  normalizeWebhookEventType,
  parseJsonRecord,
  parseScopes,
  retryProviderRequest,
  type OAuthTokenResponse
} from "./live-adapter-utils";
import { ProviderStubAdapter } from "./provider-stub-adapter";

const GMAIL_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const DEFAULT_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify"
];

type GmailLabel = {
  id: string;
  name: string;
  type?: string;
};

type GmailMessageListItem = {
  id: string;
};

type GmailMessageHeader = {
  name?: string;
  value?: string;
};

type GmailMessagePart = {
  mimeType?: string;
  body?: {
    size?: number;
    data?: string;
  };
  parts?: GmailMessagePart[];
  headers?: GmailMessageHeader[];
};

type GmailMessageResponse = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailMessagePart;
  internalDate?: string;
};

export class GmailProviderAdapter extends BaseMailAdapter implements MailProviderAdapter {
  readonly provider = "GMAIL" as const;

  private readonly stub = new ProviderStubAdapter({
    provider: "GMAIL",
    defaultDomain: "gmail.local",
    defaultScopes: DEFAULT_SCOPES,
    containers: [
      { id: "INBOX", name: "Inbox", type: "system" },
      { id: "SENT", name: "Sent", type: "system" },
      { id: "DRAFT", name: "Drafts", type: "system" },
      { id: "TRASH", name: "Trash", type: "system" }
    ]
  });

  buildAuthorizationUrl(input: OAuthStartInput): string {
    if (!this.useLiveApi()) {
      return this.stub.buildAuthorizationUrl(input);
    }

    const clientId = this.requireEnv("GMAIL_CLIENT_ID");
    const url = new URL(GMAIL_AUTH_BASE);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", DEFAULT_SCOPES.join(" "));
    url.searchParams.set("state", input.state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");

    if (input.loginHint) {
      url.searchParams.set("login_hint", input.loginHint);
    }

    return url.toString();
  }

  async connect(authCode: string, redirectUri: string): Promise<ProviderAuthResult> {
    if (!this.useLiveApi()) {
      return this.stub.connect(authCode, redirectUri);
    }

    const tokenResponse = await this.exchangeAuthorizationCode(authCode, redirectUri);
    const profile = await this.getProfile(tokenResponse.access_token);
    const expiresAt = expiresAtFromNow(tokenResponse.expires_in);

    return {
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      accessToken: tokenResponse.access_token,
      ...(tokenResponse.refresh_token ? { refreshToken: tokenResponse.refresh_token } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      scopes: parseScopes(tokenResponse.scope, DEFAULT_SCOPES)
    };
  }

  async refreshToken(refreshToken: string): Promise<ProviderAuthResult> {
    if (!this.useLiveApi()) {
      return this.stub.refreshToken(refreshToken);
    }

    const body = new URLSearchParams({
      client_id: this.requireEnv("GMAIL_CLIENT_ID"),
      client_secret: this.requireEnv("GMAIL_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    });

    const tokenResponse = await this.postToken(body);
    const profile = await this.getProfile(tokenResponse.access_token);
    const expiresAt = expiresAtFromNow(tokenResponse.expires_in);

    return {
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      accessToken: tokenResponse.access_token,
      ...(tokenResponse.refresh_token ? { refreshToken: tokenResponse.refresh_token } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      scopes: parseScopes(tokenResponse.scope, DEFAULT_SCOPES)
    };
  }

  async listMailboxes(accessToken: string): Promise<ProviderMailbox[]> {
    if (!this.useLiveApi()) {
      return this.stub.listMailboxes(accessToken);
    }

    const profile = await this.getProfile(accessToken);

    return [
      {
        id: profile.providerAccountId,
        email: profile.email,
        ...(profile.displayName ? { displayName: profile.displayName } : {}),
        isPrimary: true
      }
    ];
  }

  async listFoldersOrLabels(accessToken: string, _mailboxId: string): Promise<ProviderContainer[]> {
    if (!this.useLiveApi()) {
      return this.stub.listFoldersOrLabels(accessToken, _mailboxId);
    }

    const response = await this.requestJson<{ labels?: GmailLabel[] }>(
      `${GMAIL_API_BASE}/labels`,
      {
        headers: this.authHeaders(accessToken)
      }
    );

    return (response.labels ?? []).map((label) => ({
      id: label.id,
      name: label.name,
      type: label.type === "system" ? "system" : "label"
    }));
  }

  async syncMessages(accessToken: string, request: SyncRequest): Promise<SyncResult> {
    if (!this.useLiveApi()) {
      return this.stub.syncMessages(accessToken, request);
    }

    if (request.cursor) {
      try {
        return await this.syncFromHistory(accessToken, request);
      } catch (error) {
        if (error instanceof ProviderError && error.code === "NOT_FOUND") {
          return this.syncByListing(accessToken, request);
        }

        throw error;
      }
    }

    return this.syncByListing(accessToken, request);
  }

  async getMessage(accessToken: string, messageId: string): Promise<GetMessageResult> {
    if (!this.useLiveApi()) {
      return this.stub.getMessage(accessToken, messageId);
    }

    const raw = await this.requestJson<GmailMessageResponse>(`${GMAIL_API_BASE}/messages/${messageId}?format=full`, {
      headers: this.authHeaders(accessToken)
    });

    return mapGmailMessage(raw, {
      includeBody: true
    });
  }

  async getThread(accessToken: string, threadId: string): Promise<ProviderMessage[]> {
    if (!this.useLiveApi()) {
      return this.stub.getThread(accessToken, threadId);
    }

    const raw = await this.requestJson<{ messages?: GmailMessageResponse[] }>(
      `${GMAIL_API_BASE}/threads/${threadId}?format=full`,
      {
        headers: this.authHeaders(accessToken)
      }
    );

    return (raw.messages ?? []).map((message) => mapGmailMessage(message));
  }

  async sendMessage(accessToken: string, input: SendMessageInput): Promise<{ providerMessageId: string }> {
    if (!this.useLiveApi()) {
      return this.stub.sendMessage(accessToken, input);
    }

    const raw = Buffer.from(buildMimeMessage(input)).toString("base64url");
    const response = await this.requestJson<{ id?: string }>(`${GMAIL_API_BASE}/messages/send`, {
      method: "POST",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ raw })
    });

    return {
      providerMessageId: response.id ?? makeDeterministicExternalId("gmail-sent")
    };
  }

  async createDraft(accessToken: string, input: DraftInput): Promise<{ providerDraftId: string }> {
    if (!this.useLiveApi()) {
      return this.stub.createDraft(accessToken, input);
    }

    const raw = Buffer.from(buildMimeMessage(input)).toString("base64url");
    const response = await this.requestJson<{ id?: string }>(`${GMAIL_API_BASE}/drafts`, {
      method: "POST",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          raw
        }
      })
    });

    return {
      providerDraftId: response.id ?? makeDeterministicExternalId("gmail-draft")
    };
  }

  async updateDraft(accessToken: string, input: DraftInput): Promise<{ providerDraftId: string }> {
    if (!this.useLiveApi()) {
      return this.stub.updateDraft(accessToken, input);
    }

    if (!input.draftId) {
      return this.createDraft(accessToken, input);
    }

    const raw = Buffer.from(buildMimeMessage(input)).toString("base64url");
    const response = await this.requestJson<{ id?: string }>(`${GMAIL_API_BASE}/drafts/${input.draftId}`, {
      method: "PUT",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: input.draftId,
        message: {
          raw
        }
      })
    });

    return {
      providerDraftId: response.id ?? input.draftId
    };
  }

  async deleteMessage(accessToken: string, messageId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.deleteMessage(accessToken, messageId);
    }

    await this.requestVoid(`${GMAIL_API_BASE}/messages/${messageId}`, {
      method: "DELETE",
      headers: this.authHeaders(accessToken)
    });
  }

  async archiveMessage(accessToken: string, messageId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.archiveMessage(accessToken, messageId);
    }

    await this.modifyLabels(accessToken, messageId, {
      removeLabelIds: ["INBOX"]
    });
  }

  async markRead(accessToken: string, messageId: string, read: boolean): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.markRead(accessToken, messageId, read);
    }

    await this.modifyLabels(accessToken, messageId, {
      ...(read ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] })
    });
  }

  async moveMessage(accessToken: string, input: MoveMessageInput): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.moveMessage(accessToken, input);
    }

    await this.modifyLabels(accessToken, input.messageId, {
      addLabelIds: [input.targetContainerId],
      removeLabelIds: ["INBOX"]
    });
  }

  async addLabel(accessToken: string, messageId: string, labelId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.addLabel(accessToken, messageId, labelId);
    }

    await this.modifyLabels(accessToken, messageId, {
      addLabelIds: [labelId]
    });
  }

  async removeLabel(accessToken: string, messageId: string, labelId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.removeLabel(accessToken, messageId, labelId);
    }

    await this.modifyLabels(accessToken, messageId, {
      removeLabelIds: [labelId]
    });
  }

  async watch(accessToken: string, request: WatchRequest): Promise<WatchResponse> {
    if (!this.useLiveApi()) {
      return this.stub.watch(accessToken, request);
    }

    const topicName = process.env.GMAIL_PUBSUB_TOPIC;
    if (!hasValue(topicName)) {
      throw new ProviderError({
        provider: this.provider,
        code: "INVALID_REQUEST",
        message: "GMAIL_PUBSUB_TOPIC tanımlı olmadığı için watch başlatılamadı",
        retryable: false
      });
    }

    const response = await this.requestJson<{ historyId?: string; expiration?: string }>(
      `${GMAIL_API_BASE}/watch`,
      {
        method: "POST",
        headers: {
          ...this.authHeaders(accessToken),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          labelIds: ["INBOX"],
          topicName
        })
      }
    );

    return {
      watchId: response.historyId ?? `${request.mailboxId}-watch`,
      ...(response.expiration ? { expiresAt: new Date(Number(response.expiration)) } : {})
    };
  }

  async stopWatch(accessToken: string, watchId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.stopWatch(accessToken, watchId);
    }

    await this.requestVoid(`${GMAIL_API_BASE}/stop`, {
      method: "POST",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id: watchId })
    });
  }

  async getProfile(accessToken: string): Promise<MailboxProfile> {
    if (!this.useLiveApi()) {
      return this.stub.getProfile(accessToken);
    }

    const response = await this.requestJson<{ emailAddress?: string; historyId?: string }>(
      `${GMAIL_API_BASE}/profile`,
      {
        headers: this.authHeaders(accessToken)
      }
    );

    const email = response.emailAddress;
    if (!email) {
      throw new ProviderError({
        provider: this.provider,
        code: "UNKNOWN",
        message: "Gmail profile emailAddress alanı boş döndü",
        retryable: false
      });
    }

    return {
      email,
      displayName: displayNameFromEmail(email),
      providerAccountId: email.toLowerCase()
    };
  }

  async parseWebhookEvent(input: ParseWebhookInput): Promise<ProviderWebhookEvent[]> {
    const signatureHeader =
      input.headers["x-lexoffice-signature"] ??
      input.headers["x-goog-signature"] ??
      input.headers["x-hub-signature-256"];

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

    const pubSubMessage = parsed.message;
    if (pubSubMessage && typeof pubSubMessage === "object") {
      const dataEncoded = asString((pubSubMessage as Record<string, unknown>).data);
      const publishedAt = asString((pubSubMessage as Record<string, unknown>).publishTime);

      if (dataEncoded) {
        const decoded = parseJsonRecord(decodeBase64UrlToString(dataEncoded));
        if (decoded) {
          const mailboxEmail = asString(decoded.emailAddress);
          const historyId = asString(decoded.historyId);

          return [
            {
              ...(mailboxEmail ? { providerAccountId: mailboxEmail.toLowerCase() } : {}),
              ...(mailboxEmail ? { mailboxEmail } : {}),
              eventType: "MAILBOX_SYNC_REQUIRED",
              occurredAt: publishedAt ? new Date(publishedAt) : new Date(),
              ...(historyId ? { externalEventId: historyId } : {}),
              payload: decoded
            }
          ];
        }
      }
    }

    const events = asArray(parsed.events);
    if (events.length === 0) {
      return [];
    }

    return events
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => {
        const payload = entry as Record<string, unknown>;
        const mailboxEmail = asString(payload.mailboxEmail);
        const providerAccountId = asString(payload.providerAccountId);
        const externalEventId = asString(payload.externalEventId);
        return {
          ...(providerAccountId ? { providerAccountId } : {}),
          ...(mailboxEmail ? { mailboxEmail } : {}),
          eventType: normalizeWebhookEventType(payload.eventType),
          occurredAt: parseWebhookDate(payload.occurredAt) ?? new Date(),
          ...(externalEventId ? { externalEventId } : {}),
          payload
        } as ProviderWebhookEvent;
      });
  }

  private useLiveApi(): boolean {
    return isLiveProviderEnabled(this.provider);
  }

  private async syncFromHistory(accessToken: string, request: SyncRequest): Promise<SyncResult> {
    const maxResults = clampMaxResults(request.maxResults);
    const response = await this.requestJson<{
      history?: Array<{
        id?: string;
        messagesAdded?: Array<{ message?: GmailMessageListItem }>;
      }>;
      historyId?: string;
    }>(
      `${GMAIL_API_BASE}/history?startHistoryId=${encodeURIComponent(
        request.cursor ?? ""
      )}&historyTypes=messageAdded&maxResults=${maxResults}`,
      {
        headers: this.authHeaders(accessToken)
      }
    );

    const ids = new Set<string>();
    for (const historyEntry of response.history ?? []) {
      for (const added of historyEntry.messagesAdded ?? []) {
        const id = added.message?.id;
        if (id) {
          ids.add(id);
        }
      }
    }

    const messages = await this.fetchMessageMetadataBatch(accessToken, [...ids]);
    const nextCursor = response.historyId ?? request.cursor;

    return {
      messages,
      ...(nextCursor ? { nextCursor } : {}),
      hasMore: false
    };
  }

  private async syncByListing(accessToken: string, request: SyncRequest): Promise<SyncResult> {
    const maxResults = clampMaxResults(request.maxResults);
    const response = await this.requestJson<{ messages?: GmailMessageListItem[]; nextPageToken?: string }>(
      `${GMAIL_API_BASE}/messages?maxResults=${maxResults}`,
      {
        headers: this.authHeaders(accessToken)
      }
    );

    const messageIds = (response.messages ?? []).map((item) => item.id).filter((id) => id.length > 0);
    const messages = await this.fetchMessageMetadataBatch(accessToken, messageIds);
    const cursor = await this.fetchHistoryId(accessToken);

    return {
      messages,
      ...(cursor ? { nextCursor: cursor } : {}),
      hasMore: Boolean(response.nextPageToken)
    };
  }

  private async fetchHistoryId(accessToken: string): Promise<string | undefined> {
    const response = await this.requestJson<{ historyId?: string }>(`${GMAIL_API_BASE}/profile`, {
      headers: this.authHeaders(accessToken)
    });

    return response.historyId;
  }

  private async fetchMessageMetadataBatch(
    accessToken: string,
    messageIds: string[]
  ): Promise<ProviderMessage[]> {
    const results: ProviderMessage[] = [];

    for (const messageId of messageIds.slice(0, 25)) {
      const raw = await this.requestJson<GmailMessageResponse>(
        `${GMAIL_API_BASE}/messages/${messageId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        {
          headers: this.authHeaders(accessToken)
        }
      );

      results.push(mapGmailMessage(raw));
    }

    return results;
  }

  private async modifyLabels(
    accessToken: string,
    messageId: string,
    payload: { addLabelIds?: string[]; removeLabelIds?: string[] }
  ): Promise<void> {
    await this.requestVoid(`${GMAIL_API_BASE}/messages/${messageId}/modify`, {
      method: "POST",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  }

  private async exchangeAuthorizationCode(
    authCode: string,
    redirectUri: string
  ): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.requireEnv("GMAIL_CLIENT_ID"),
      client_secret: this.requireEnv("GMAIL_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      code: authCode,
      grant_type: "authorization_code"
    });

    return this.postToken(body);
  }

  private async postToken(body: URLSearchParams): Promise<OAuthTokenResponse> {
    const response = await retryProviderRequest(
      async () => {
        const res = await fetch(GMAIL_TOKEN_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body
        });

        if (!res.ok) {
          throw await this.buildHttpError(res);
        }

        return (await res.json()) as OAuthTokenResponse;
      },
      (error) => this.isRetryableError(error)
    );

    if (!response.access_token) {
      throw new ProviderError({
        provider: this.provider,
        code: "UNKNOWN",
        message: "Gmail token endpoint access_token döndürmedi",
        retryable: false
      });
    }

    if (!response.scope && response.id_token) {
      const jwtPayload = decodeJwtPayload(response.id_token);
      const scopesFromJwt = asString(jwtPayload?.scope);
      if (scopesFromJwt) {
        response.scope = scopesFromJwt;
      }
    }

    return response;
  }

  private async requestJson<T>(url: string, init: RequestInit): Promise<T> {
    return retryProviderRequest(
      async () => {
        const response = await fetch(url, init);
        if (!response.ok) {
          throw await this.buildHttpError(response);
        }

        return (await response.json()) as T;
      },
      (error) => this.isRetryableError(error)
    );
  }

  private async requestVoid(url: string, init: RequestInit): Promise<void> {
    await retryProviderRequest(
      async () => {
        const response = await fetch(url, init);
        if (!response.ok) {
          throw await this.buildHttpError(response);
        }
      },
      (error) => this.isRetryableError(error)
    );
  }

  private authHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`
    };
  }

  private requireEnv(key: "GMAIL_CLIENT_ID" | "GMAIL_CLIENT_SECRET"): string {
    const value = process.env[key];
    if (!value || value.trim().length === 0) {
      throw new ProviderError({
        provider: this.provider,
        code: "INVALID_REQUEST",
        message: `${key} tanımlı değil`,
        retryable: false
      });
    }

    return value;
  }

  private async buildHttpError(response: Response): Promise<ProviderError> {
    let message = `${this.provider} API request başarısız`;

    try {
      const payload = (await response.json()) as {
        error?: { message?: string };
        error_description?: string;
      };
      message =
        payload.error?.message ??
        payload.error_description ??
        message;
    } catch {
      const text = await response.text();
      if (text.length > 0) {
        message = text.slice(0, 500);
      }
    }

    return this.normalizeHttpError(this.provider, response.status, message);
  }

  private isRetryableError(error: unknown): boolean {
    return error instanceof ProviderError && error.retryable;
  }
}

function parseWebhookDate(value: unknown): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

function clampMaxResults(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return 25;
  }

  return Math.max(1, Math.min(value, 100));
}

function mapGmailMessage(
  message: GmailMessageResponse,
  options?: {
    includeBody?: boolean;
  }
): GetMessageResult {
  const headers = message.payload?.headers ?? [];
  const subject = readHeader(headers, "subject");
  const from = readHeader(headers, "from");
  const fromParsed = parseMailboxIdentity(from);
  const sentAt = readDateFromHeader(headers, "date");
  const receivedAt = parseInternalDate(message.internalDate) ?? sentAt;
  const labelIds = message.labelIds ?? [];

  const mapped: GetMessageResult = {
    id: message.id,
    threadId: message.threadId ?? message.id,
    ...(subject ? { subject } : {}),
    ...(message.snippet ? { snippet: message.snippet } : {}),
    fromEmail: fromParsed.email ?? "unknown@example.com",
    ...(fromParsed.name ? { fromName: fromParsed.name } : {}),
    ...(sentAt ? { sentAt } : {}),
    ...(receivedAt ? { receivedAt } : {}),
    isRead: !labelIds.includes("UNREAD"),
    isStarred: labelIds.includes("STARRED"),
    labelsOrFolders: labelIds
  };

  if (options?.includeBody) {
    const extracted = extractBodies(message.payload);
    if (extracted.text) {
      mapped.bodyText = extracted.text;
    }

    if (extracted.html) {
      mapped.bodyHtml = extracted.html;
    }
  }

  return mapped;
}

function extractBodies(payload: GmailMessagePart | undefined): { text?: string; html?: string } {
  if (!payload) {
    return {};
  }

  const textParts: string[] = [];
  const htmlParts: string[] = [];
  const queue: GmailMessagePart[] = [payload];

  while (queue.length > 0) {
    const part = queue.shift();
    if (!part) {
      continue;
    }

    if (Array.isArray(part.parts) && part.parts.length > 0) {
      queue.push(...part.parts);
      continue;
    }

    const bodyData = part.body?.data;
    if (!bodyData) {
      continue;
    }

    const decoded = decodeBase64UrlToString(bodyData);
    if (part.mimeType?.includes("text/html")) {
      htmlParts.push(decoded);
      continue;
    }

    textParts.push(decoded);
  }

  return {
    ...(textParts.length > 0 ? { text: textParts.join("\n") } : {}),
    ...(htmlParts.length > 0 ? { html: htmlParts.join("\n") } : {})
  };
}

function readHeader(headers: GmailMessageHeader[], target: string): string | undefined {
  const lowered = target.toLowerCase();

  for (const header of headers) {
    if (header.name?.toLowerCase() === lowered && header.value) {
      return header.value;
    }
  }

  return undefined;
}

function parseMailboxIdentity(rawValue: string | undefined): { email?: string; name?: string } {
  if (!rawValue) {
    return {};
  }

  const angleMatch = rawValue.match(/^(.*)<([^>]+)>$/);
  if (angleMatch) {
    const namePart = angleMatch[1]?.trim().replace(/^"|"$/g, "");
    const emailPart = angleMatch[2]?.trim();
    return {
      ...(emailPart ? { email: emailPart.toLowerCase() } : {}),
      ...(namePart && namePart.length > 0 ? { name: namePart } : {})
    };
  }

  if (rawValue.includes("@")) {
    return {
      email: rawValue.trim().toLowerCase()
    };
  }

  return {
    name: rawValue.trim()
  };
}

function readDateFromHeader(headers: GmailMessageHeader[], key: string): Date | undefined {
  const raw = readHeader(headers, key);
  if (!raw) {
    return undefined;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

function parseInternalDate(value: string | undefined): Date | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }

  const millis = Number(value);
  if (!Number.isFinite(millis)) {
    return undefined;
  }

  return new Date(millis);
}

function buildMimeMessage(input: SendMessageInput | DraftInput): string {
  const lines: string[] = [];

  const from = "LexOffice AI <no-reply@lexoffice.ai>";
  lines.push(`From: ${from}`);
  lines.push(`To: ${input.to.join(", ")}`);

  if (input.cc && input.cc.length > 0) {
    lines.push(`Cc: ${input.cc.join(", ")}`);
  }

  if (input.bcc && input.bcc.length > 0) {
    lines.push(`Bcc: ${input.bcc.join(", ")}`);
  }

  if (input.inReplyToMessageId) {
    lines.push(`In-Reply-To: ${input.inReplyToMessageId}`);
  }

  lines.push(`Subject: ${encodeMimeHeader(input.subject)}`);
  lines.push("MIME-Version: 1.0");

  const hasAttachments = Array.isArray(input.attachments) && input.attachments.length > 0;
  if (!hasAttachments) {
    if (input.bodyHtml) {
      lines.push('Content-Type: text/html; charset="UTF-8"');
      lines.push("Content-Transfer-Encoding: 8bit");
      lines.push("");
      lines.push(input.bodyHtml);
    } else {
      lines.push('Content-Type: text/plain; charset="UTF-8"');
      lines.push("Content-Transfer-Encoding: 8bit");
      lines.push("");
      lines.push(input.bodyText ?? "");
    }

    return lines.join("\r\n");
  }

  const boundary = `lexoffice-${Date.now().toString(16)}`;
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push("");
  lines.push(`--${boundary}`);

  if (input.bodyHtml) {
    lines.push('Content-Type: text/html; charset="UTF-8"');
  } else {
    lines.push('Content-Type: text/plain; charset="UTF-8"');
  }

  lines.push("Content-Transfer-Encoding: 8bit");
  lines.push("");
  lines.push(input.bodyHtml ?? input.bodyText ?? "");

  for (const attachment of input.attachments ?? []) {
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${attachment.mimeType}; name="${escapeHeaderValue(attachment.name)}"`);
    lines.push(`Content-Disposition: attachment; filename="${escapeHeaderValue(attachment.name)}"`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(chunkBase64(attachment.contentBase64));
  }

  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

function chunkBase64(value: string): string {
  return value.replace(/\s+/g, "").match(/.{1,76}/g)?.join("\r\n") ?? value;
}

function encodeMimeHeader(value: string): string {
  if (!/[^\x20-\x7E]/.test(value)) {
    return value;
  }

  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function escapeHeaderValue(value: string): string {
  return value.replace(/[\r\n"]/g, " ").trim();
}

function displayNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "Mailbox";

  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}
