import { randomUUID } from "node:crypto";
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
  expiresAtFromNow,
  isLiveProviderEnabled,
  makeDeterministicExternalId,
  normalizeWebhookEventType,
  parseJsonRecord,
  parseScopes,
  retryProviderRequest,
  type OAuthTokenResponse
} from "./live-adapter-utils";
import { ProviderStubAdapter } from "./provider-stub-adapter";

const GRAPH_DEFAULT_SCOPES = ["openid", "profile", "email", "offline_access", "Mail.Read", "Mail.Send", "Mail.ReadWrite"];
const GRAPH_AUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const GRAPH_TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";

type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  categories?: string[];
  parentFolderId?: string;
  from?: {
    emailAddress?: {
      address?: string;
      name?: string;
    };
  };
  body?: {
    contentType?: string;
    content?: string;
  };
};

type GraphMailboxProfileResponse = {
  id?: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
};

export class MicrosoftGraphMailAdapter extends BaseMailAdapter implements MailProviderAdapter {
  readonly provider = "MICROSOFT_365" as const;

  private readonly stub = new ProviderStubAdapter({
    provider: "MICROSOFT_365",
    defaultDomain: "m365.local",
    defaultScopes: GRAPH_DEFAULT_SCOPES,
    containers: [
      { id: "inbox", name: "Inbox", type: "folder" },
      { id: "sentitems", name: "Sent Items", type: "folder" },
      { id: "drafts", name: "Drafts", type: "folder" },
      { id: "archive", name: "Archive", type: "folder" }
    ]
  });

  buildAuthorizationUrl(input: OAuthStartInput): string {
    if (!this.useLiveApi()) {
      return this.stub.buildAuthorizationUrl(input);
    }

    const clientId = this.requireEnv("MICROSOFT_CLIENT_ID");
    const url = new URL(GRAPH_AUTH_BASE);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", GRAPH_DEFAULT_SCOPES.join(" "));
    url.searchParams.set("state", input.state);

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
      scopes: parseScopes(tokenResponse.scope, GRAPH_DEFAULT_SCOPES)
    };
  }

  async refreshToken(refreshToken: string): Promise<ProviderAuthResult> {
    if (!this.useLiveApi()) {
      return this.stub.refreshToken(refreshToken);
    }

    const body = new URLSearchParams({
      client_id: this.requireEnv("MICROSOFT_CLIENT_ID"),
      client_secret: this.requireEnv("MICROSOFT_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: GRAPH_DEFAULT_SCOPES.join(" ")
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
      scopes: parseScopes(tokenResponse.scope, GRAPH_DEFAULT_SCOPES)
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

    const response = await this.requestJson<{
      value?: Array<{
        id?: string;
        displayName?: string;
        parentFolderId?: string;
        wellKnownName?: string;
      }>;
    }>(
      `${GRAPH_API_BASE}/me/mailFolders?$top=100&$select=id,displayName,parentFolderId,wellKnownName`,
      {
        headers: this.authHeaders(accessToken)
      }
    );

    return (response.value ?? [])
      .filter((folder) => typeof folder.id === "string" && typeof folder.displayName === "string")
      .map((folder) => ({
        id: folder.id as string,
        name: folder.displayName as string,
        type: (folder.wellKnownName ? "system" : "folder") as "folder" | "system",
        ...(folder.parentFolderId ? { parentId: folder.parentFolderId } : {})
      }));
  }

  async syncMessages(accessToken: string, request: SyncRequest): Promise<SyncResult> {
    if (!this.useLiveApi()) {
      return this.stub.syncMessages(accessToken, request);
    }

    const max = clampMaxResults(request.maxResults);
    const deltaUrl =
      request.cursor && request.cursor.startsWith("http")
        ? request.cursor
        : `${GRAPH_API_BASE}/me/messages/delta?$top=${max}&$select=id,conversationId,subject,bodyPreview,from,receivedDateTime,sentDateTime,isRead,categories,parentFolderId`;

    const response = await this.requestJson<{
      value?: GraphMessage[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    }>(deltaUrl, {
      headers: this.authHeaders(accessToken)
    });

    const messages = (response.value ?? []).filter((entry) => typeof entry.id === "string").map((entry) =>
      mapGraphMessage(entry)
    );

    const nextCursor = response["@odata.deltaLink"] ?? response["@odata.nextLink"];

    return {
      messages,
      ...(nextCursor ? { nextCursor } : {}),
      hasMore: Boolean(response["@odata.nextLink"])
    };
  }

  async getMessage(accessToken: string, messageId: string): Promise<GetMessageResult> {
    if (!this.useLiveApi()) {
      return this.stub.getMessage(accessToken, messageId);
    }

    const message = await this.requestJson<GraphMessage>(
      `${GRAPH_API_BASE}/me/messages/${encodeURIComponent(
        messageId
      )}?$select=id,conversationId,subject,bodyPreview,body,from,receivedDateTime,sentDateTime,isRead,categories,parentFolderId`,
      {
        headers: this.authHeaders(accessToken)
      }
    );

    return mapGraphMessage(message, { includeBody: true });
  }

  async getThread(accessToken: string, threadId: string): Promise<ProviderMessage[]> {
    if (!this.useLiveApi()) {
      return this.stub.getThread(accessToken, threadId);
    }

    const escaped = threadId.replace(/'/g, "''");
    const response = await this.requestJson<{ value?: GraphMessage[] }>(
      `${GRAPH_API_BASE}/me/messages?$filter=conversationId eq '${encodeURIComponent(
        escaped
      )}'&$top=50&$select=id,conversationId,subject,bodyPreview,from,receivedDateTime,sentDateTime,isRead,categories,parentFolderId`,
      {
        headers: this.authHeaders(accessToken)
      }
    );

    return (response.value ?? []).map((message) => mapGraphMessage(message));
  }

  async sendMessage(accessToken: string, input: SendMessageInput): Promise<{ providerMessageId: string }> {
    if (!this.useLiveApi()) {
      return this.stub.sendMessage(accessToken, input);
    }

    await this.requestVoid(`${GRAPH_API_BASE}/me/sendMail`, {
      method: "POST",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: buildGraphMessagePayload(input),
        saveToSentItems: true
      })
    });

    return {
      providerMessageId: `graph-sent-${randomUUID()}`
    };
  }

  async createDraft(accessToken: string, input: DraftInput): Promise<{ providerDraftId: string }> {
    if (!this.useLiveApi()) {
      return this.stub.createDraft(accessToken, input);
    }

    const response = await this.requestJson<{ id?: string }>(`${GRAPH_API_BASE}/me/messages`, {
      method: "POST",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildGraphMessagePayload(input))
    });

    return {
      providerDraftId: response.id ?? makeDeterministicExternalId("graph-draft")
    };
  }

  async updateDraft(accessToken: string, input: DraftInput): Promise<{ providerDraftId: string }> {
    if (!this.useLiveApi()) {
      return this.stub.updateDraft(accessToken, input);
    }

    if (!input.draftId) {
      return this.createDraft(accessToken, input);
    }

    await this.requestVoid(`${GRAPH_API_BASE}/me/messages/${encodeURIComponent(input.draftId)}`, {
      method: "PATCH",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildGraphMessagePayload(input))
    });

    return {
      providerDraftId: input.draftId
    };
  }

  async deleteMessage(accessToken: string, messageId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.deleteMessage(accessToken, messageId);
    }

    await this.requestVoid(`${GRAPH_API_BASE}/me/messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE",
      headers: this.authHeaders(accessToken)
    });
  }

  async archiveMessage(accessToken: string, messageId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.archiveMessage(accessToken, messageId);
    }

    await this.moveMessage(accessToken, {
      messageId,
      targetContainerId: "archive"
    });
  }

  async markRead(accessToken: string, messageId: string, read: boolean): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.markRead(accessToken, messageId, read);
    }

    await this.requestVoid(`${GRAPH_API_BASE}/me/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        isRead: read
      })
    });
  }

  async moveMessage(accessToken: string, input: MoveMessageInput): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.moveMessage(accessToken, input);
    }

    await this.requestVoid(`${GRAPH_API_BASE}/me/messages/${encodeURIComponent(input.messageId)}/move`, {
      method: "POST",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        destinationId: input.targetContainerId
      })
    });
  }

  async addLabel(accessToken: string, messageId: string, labelId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.addLabel(accessToken, messageId, labelId);
    }

    const existing = await this.requestJson<{ categories?: string[] }>(
      `${GRAPH_API_BASE}/me/messages/${encodeURIComponent(messageId)}?$select=categories`,
      {
        headers: this.authHeaders(accessToken)
      }
    );

    const categories = new Set(existing.categories ?? []);
    categories.add(labelId);

    await this.requestVoid(`${GRAPH_API_BASE}/me/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        categories: [...categories]
      })
    });
  }

  async removeLabel(accessToken: string, messageId: string, labelId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.removeLabel(accessToken, messageId, labelId);
    }

    const existing = await this.requestJson<{ categories?: string[] }>(
      `${GRAPH_API_BASE}/me/messages/${encodeURIComponent(messageId)}?$select=categories`,
      {
        headers: this.authHeaders(accessToken)
      }
    );

    const categories = (existing.categories ?? []).filter((category) => category !== labelId);

    await this.requestVoid(`${GRAPH_API_BASE}/me/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        categories
      })
    });
  }

  async watch(accessToken: string, request: WatchRequest): Promise<WatchResponse> {
    if (!this.useLiveApi()) {
      return this.stub.watch(accessToken, request);
    }

    const profile = await this.getProfile(accessToken);
    const expiryDate = new Date(Date.now() + 60 * 60 * 1000);
    const webhookSecret = this.requireEnv("MICROSOFT_WEBHOOK_SECRET");
    const response = await this.requestJson<{ id?: string; expirationDateTime?: string }>(
      `${GRAPH_API_BASE}/subscriptions`,
      {
        method: "POST",
        headers: {
          ...this.authHeaders(accessToken),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          changeType: "created,updated",
          notificationUrl: request.webhookUrl,
          resource: "/me/messages",
          expirationDateTime: expiryDate.toISOString(),
          clientState: `${webhookSecret}:${profile.providerAccountId}`
        })
      }
    );

    return {
      watchId: response.id ?? makeDeterministicExternalId("graph-watch"),
      ...(response.expirationDateTime ? { expiresAt: new Date(response.expirationDateTime) } : {})
    };
  }

  async stopWatch(accessToken: string, watchId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.stopWatch(accessToken, watchId);
    }

    await this.requestVoid(`${GRAPH_API_BASE}/subscriptions/${encodeURIComponent(watchId)}`, {
      method: "DELETE",
      headers: this.authHeaders(accessToken)
    });
  }

  async getProfile(accessToken: string): Promise<MailboxProfile> {
    if (!this.useLiveApi()) {
      return this.stub.getProfile(accessToken);
    }

    const profile = await this.requestJson<GraphMailboxProfileResponse>(
      `${GRAPH_API_BASE}/me?$select=id,displayName,mail,userPrincipalName`,
      {
        headers: this.authHeaders(accessToken)
      }
    );

    const email = profile.mail ?? profile.userPrincipalName;
    if (!email) {
      throw new ProviderError({
        provider: this.provider,
        code: "UNKNOWN",
        message: "Graph profile email alanı boş döndü",
        retryable: false
      });
    }

    return {
      email: email.toLowerCase(),
      ...(profile.displayName ? { displayName: profile.displayName } : {}),
      providerAccountId: profile.id ?? email.toLowerCase()
    };
  }

  async parseWebhookEvent(input: ParseWebhookInput): Promise<ProviderWebhookEvent[]> {
    const signatureHeader =
      input.headers["x-lexoffice-signature"] ??
      input.headers["x-ms-signature"] ??
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

    const notifications = asArray(parsed.value);
    if (notifications.length === 0) {
      const events = asArray(parsed.events);
      return events
        .filter((event) => event && typeof event === "object")
        .map((event) => {
          const payload = event as Record<string, unknown>;
          return {
            ...(asString(payload.providerAccountId) ? { providerAccountId: asString(payload.providerAccountId) } : {}),
            ...(asString(payload.mailboxEmail) ? { mailboxEmail: asString(payload.mailboxEmail) } : {}),
            eventType: normalizeWebhookEventType(payload.eventType),
            occurredAt: parseTimestamp(payload.occurredAt) ?? new Date(),
            payload
          } as ProviderWebhookEvent;
        });
    }

    return notifications
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const payload = item as Record<string, unknown>;
        const changeType = asString(payload.changeType);
        const clientState = asString(payload.clientState);
        const accountId = extractAccountId(clientState);
        const externalEventId = asString(payload.subscriptionId);

        return {
          ...(accountId ? { providerAccountId: accountId } : {}),
          eventType:
            changeType === "created"
              ? "MESSAGE_RECEIVED"
              : changeType === "updated"
                ? "MESSAGE_UPDATED"
                : "MAILBOX_SYNC_REQUIRED",
          occurredAt: parseTimestamp(payload.subscriptionExpirationDateTime) ?? new Date(),
          ...(externalEventId ? { externalEventId } : {}),
          payload
        };
      });
  }

  private useLiveApi(): boolean {
    return isLiveProviderEnabled(this.provider);
  }

  private async exchangeAuthorizationCode(
    authCode: string,
    redirectUri: string
  ): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.requireEnv("MICROSOFT_CLIENT_ID"),
      client_secret: this.requireEnv("MICROSOFT_CLIENT_SECRET"),
      code: authCode,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: GRAPH_DEFAULT_SCOPES.join(" ")
    });

    return this.postToken(body);
  }

  private async postToken(body: URLSearchParams): Promise<OAuthTokenResponse> {
    const response = await retryProviderRequest(
      async () => {
        const res = await fetch(GRAPH_TOKEN_ENDPOINT, {
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
        message: "Microsoft token endpoint access_token döndürmedi",
        retryable: false
      });
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

        if (response.status === 204) {
          return {} as T;
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

  private requireEnv(
    key: "MICROSOFT_CLIENT_ID" | "MICROSOFT_CLIENT_SECRET" | "MICROSOFT_WEBHOOK_SECRET"
  ): string {
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
        error?: { message?: string; code?: string };
      };

      message = payload.error?.message ?? payload.error?.code ?? message;
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

function mapGraphMessage(
  message: GraphMessage,
  options?: {
    includeBody?: boolean;
  }
): GetMessageResult {
  const fromAddress = message.from?.emailAddress?.address?.toLowerCase() ?? "unknown@example.com";
  const sentAt = parseTimestamp(message.sentDateTime);
  const receivedAt = parseTimestamp(message.receivedDateTime) ?? sentAt;

  const mapped: GetMessageResult = {
    id: message.id,
    threadId: message.conversationId ?? message.id,
    ...(message.subject ? { subject: message.subject } : {}),
    ...(message.bodyPreview ? { snippet: message.bodyPreview } : {}),
    fromEmail: fromAddress,
    ...(message.from?.emailAddress?.name ? { fromName: message.from.emailAddress.name } : {}),
    ...(sentAt ? { sentAt } : {}),
    ...(receivedAt ? { receivedAt } : {}),
    isRead: Boolean(message.isRead),
    isStarred: false,
    labelsOrFolders: [
      ...(message.parentFolderId ? [message.parentFolderId] : []),
      ...((message.categories ?? []).filter((item) => item.length > 0) as string[])
    ]
  };

  if (options?.includeBody) {
    const content = message.body?.content;
    const contentType = message.body?.contentType?.toLowerCase();

    if (content) {
      if (contentType === "html") {
        mapped.bodyHtml = content;
      } else {
        mapped.bodyText = content;
      }
    }
  }

  return mapped;
}

function buildGraphMessagePayload(input: SendMessageInput | DraftInput): Record<string, unknown> {
  return {
    subject: input.subject,
    body: {
      contentType: input.bodyHtml ? "HTML" : "Text",
      content: input.bodyHtml ?? input.bodyText ?? ""
    },
    toRecipients: input.to.map((email) => ({
      emailAddress: {
        address: email
      }
    })),
    ...(input.cc && input.cc.length > 0
      ? {
          ccRecipients: input.cc.map((email) => ({
            emailAddress: {
              address: email
            }
          }))
        }
      : {}),
    ...(input.bcc && input.bcc.length > 0
      ? {
          bccRecipients: input.bcc.map((email) => ({
            emailAddress: {
              address: email
            }
          }))
        }
      : {}),
    ...(input.attachments && input.attachments.length > 0
      ? {
          attachments: input.attachments.map((attachment) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: attachment.name,
            contentType: attachment.mimeType,
            contentBytes: attachment.contentBase64
          }))
        }
      : {})
  };
}

function parseTimestamp(value: string | unknown): Date | undefined {
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
  if (!value || !Number.isFinite(value)) {
    return 25;
  }

  return Math.max(1, Math.min(value, 100));
}

function extractAccountId(clientState: string | undefined): string | undefined {
  if (!clientState) {
    return undefined;
  }

  const segments = clientState.split(":");
  return segments.at(-1);
}
