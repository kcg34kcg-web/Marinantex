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
  decodeJwtPayload,
  expiresAtFromNow,
  hasValue,
  isLiveProviderEnabled,
  normalizeWebhookEventType,
  parseJsonRecord,
  parseScopes,
  retryProviderRequest,
  type OAuthTokenResponse
} from "./live-adapter-utils";
import { ProviderStubAdapter } from "./provider-stub-adapter";

const YANDEX_AUTH_URL = "https://oauth.yandex.com/authorize";
const YANDEX_TOKEN_URL = "https://oauth.yandex.com/token";
const YANDEX_PROFILE_URL = "https://login.yandex.ru/info?format=json";
const YANDEX_DEFAULT_SCOPES = ["login:email", "mail:read", "mail:write", "mail:send"];

type YandexProfileResponse = {
  id?: string;
  login?: string;
  default_email?: string;
  real_name?: string;
};

export class YandexMailAdapter extends BaseMailAdapter implements MailProviderAdapter {
  readonly provider = "YANDEX" as const;

  private readonly stub = new ProviderStubAdapter({
    provider: "YANDEX",
    defaultDomain: "yandex.local",
    defaultScopes: YANDEX_DEFAULT_SCOPES,
    containers: [
      { id: "inbox", name: "Inbox", type: "folder" },
      { id: "sent", name: "Sent", type: "folder" },
      { id: "drafts", name: "Drafts", type: "folder" },
      { id: "spam", name: "Spam", type: "folder" }
    ]
  });

  buildAuthorizationUrl(input: OAuthStartInput): string {
    if (!this.useLiveApi()) {
      return this.stub.buildAuthorizationUrl(input);
    }

    const clientId = this.requireEnv("YANDEX_CLIENT_ID");
    const url = new URL(YANDEX_AUTH_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("scope", YANDEX_DEFAULT_SCOPES.join(" "));
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

    const token = await this.exchangeAuthorizationCode(authCode, redirectUri);
    const profile = await this.getProfile(token.access_token);
    const expiresAt = expiresAtFromNow(token.expires_in);

    return {
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      accessToken: token.access_token,
      ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      scopes: parseScopes(token.scope, YANDEX_DEFAULT_SCOPES)
    };
  }

  async refreshToken(refreshToken: string): Promise<ProviderAuthResult> {
    if (!this.useLiveApi()) {
      return this.stub.refreshToken(refreshToken);
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.requireEnv("YANDEX_CLIENT_ID"),
      client_secret: this.requireEnv("YANDEX_CLIENT_SECRET"),
      refresh_token: refreshToken
    });

    const token = await this.postToken(body);
    const profile = await this.getProfile(token.access_token);
    const expiresAt = expiresAtFromNow(token.expires_in);

    return {
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      accessToken: token.access_token,
      ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      scopes: parseScopes(token.scope, YANDEX_DEFAULT_SCOPES)
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

  async listFoldersOrLabels(accessToken: string, mailboxId: string): Promise<ProviderContainer[]> {
    if (!this.useLiveApi()) {
      return this.stub.listFoldersOrLabels(accessToken, mailboxId);
    }
    const apiBase = this.requireMailApiBase();

    const response = await this.requestJson<{ folders?: Array<{ id?: string; name?: string; parentId?: string }> }>(
      `${apiBase.replace(/\/$/, "")}/folders`,
      {
        headers: this.authHeaders(accessToken)
      }
    );

    return (response.folders ?? [])
      .filter((folder) => typeof folder.id === "string" && typeof folder.name === "string")
      .map((folder) => ({
        id: folder.id as string,
        name: folder.name as string,
        type: "folder" as const,
        ...(folder.parentId ? { parentId: folder.parentId } : {})
      }));
  }

  async syncMessages(accessToken: string, request: SyncRequest): Promise<SyncResult> {
    if (!this.useLiveApi()) {
      return this.stub.syncMessages(accessToken, request);
    }
    const apiBase = this.requireMailApiBase();

    const maxResults = clampMaxResults(request.maxResults);
    const url = new URL(`${apiBase.replace(/\/$/, "")}/messages`);
    url.searchParams.set("mailboxId", request.mailboxId);
    url.searchParams.set("limit", String(maxResults));
    if (request.cursor) {
      url.searchParams.set("cursor", request.cursor);
    }

    const response = await this.requestJson<{
      messages?: Array<{
        id?: string;
        threadId?: string;
        subject?: string;
        snippet?: string;
        fromEmail?: string;
        fromName?: string;
        sentAt?: string;
        receivedAt?: string;
        isRead?: boolean;
        isStarred?: boolean;
        labelsOrFolders?: string[];
      }>;
      nextCursor?: string;
      hasMore?: boolean;
    }>(url.toString(), {
      headers: this.authHeaders(accessToken)
    });

    return {
      messages: (response.messages ?? [])
        .filter((message) => typeof message.id === "string" && typeof message.threadId === "string")
        .map((message) => {
          const sentAt = parseDate(message.sentAt);
          const receivedAt = parseDate(message.receivedAt);

          return {
            id: message.id as string,
            threadId: message.threadId as string,
            ...(message.subject ? { subject: message.subject } : {}),
            ...(message.snippet ? { snippet: message.snippet } : {}),
            fromEmail: message.fromEmail ?? "unknown@yandex.ru",
            ...(message.fromName ? { fromName: message.fromName } : {}),
            ...(sentAt ? { sentAt } : {}),
            ...(receivedAt ? { receivedAt } : {}),
            isRead: Boolean(message.isRead),
            isStarred: Boolean(message.isStarred),
            labelsOrFolders: message.labelsOrFolders ?? []
          };
        }),
      ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
      hasMore: Boolean(response.hasMore)
    };
  }

  async getMessage(accessToken: string, messageId: string): Promise<GetMessageResult> {
    if (!this.useLiveApi()) {
      return this.stub.getMessage(accessToken, messageId);
    }
    const apiBase = this.requireMailApiBase();

    const response = await this.requestJson<{
      id?: string;
      threadId?: string;
      subject?: string;
      snippet?: string;
      fromEmail?: string;
      fromName?: string;
      sentAt?: string;
      receivedAt?: string;
      isRead?: boolean;
      isStarred?: boolean;
      labelsOrFolders?: string[];
      bodyText?: string;
      bodyHtml?: string;
    }>(`${apiBase.replace(/\/$/, "")}/messages/${encodeURIComponent(messageId)}`, {
      headers: this.authHeaders(accessToken)
    });

    if (!response.id || !response.threadId) {
      throw new ProviderError({
        provider: this.provider,
        code: "NOT_FOUND",
        message: "Yandex message bulunamadı",
        retryable: false,
        status: 404
      });
    }

    const sentAt = parseDate(response.sentAt);
    const receivedAt = parseDate(response.receivedAt);

    return {
      id: response.id,
      threadId: response.threadId,
      ...(response.subject ? { subject: response.subject } : {}),
      ...(response.snippet ? { snippet: response.snippet } : {}),
      fromEmail: response.fromEmail ?? "unknown@yandex.ru",
      ...(response.fromName ? { fromName: response.fromName } : {}),
      ...(sentAt ? { sentAt } : {}),
      ...(receivedAt ? { receivedAt } : {}),
      isRead: Boolean(response.isRead),
      isStarred: Boolean(response.isStarred),
      labelsOrFolders: response.labelsOrFolders ?? [],
      ...(response.bodyText ? { bodyText: response.bodyText } : {}),
      ...(response.bodyHtml ? { bodyHtml: response.bodyHtml } : {})
    };
  }

  async getThread(accessToken: string, threadId: string): Promise<ProviderMessage[]> {
    if (!this.useLiveApi()) {
      return this.stub.getThread(accessToken, threadId);
    }
    const apiBase = this.requireMailApiBase();

    const response = await this.requestJson<{
      messages?: Array<{
        id?: string;
        threadId?: string;
        subject?: string;
        snippet?: string;
        fromEmail?: string;
        fromName?: string;
        sentAt?: string;
        receivedAt?: string;
        isRead?: boolean;
        isStarred?: boolean;
        labelsOrFolders?: string[];
      }>;
    }>(`${apiBase.replace(/\/$/, "")}/threads/${encodeURIComponent(threadId)}`, {
      headers: this.authHeaders(accessToken)
    });

    return (response.messages ?? [])
      .filter((message) => typeof message.id === "string" && typeof message.threadId === "string")
      .map((message) => {
        const sentAt = parseDate(message.sentAt);
        const receivedAt = parseDate(message.receivedAt);

        return {
          id: message.id as string,
          threadId: message.threadId as string,
          ...(message.subject ? { subject: message.subject } : {}),
          ...(message.snippet ? { snippet: message.snippet } : {}),
          fromEmail: message.fromEmail ?? "unknown@yandex.ru",
          ...(message.fromName ? { fromName: message.fromName } : {}),
          ...(sentAt ? { sentAt } : {}),
          ...(receivedAt ? { receivedAt } : {}),
          isRead: Boolean(message.isRead),
          isStarred: Boolean(message.isStarred),
          labelsOrFolders: message.labelsOrFolders ?? []
        };
      });
  }

  async sendMessage(accessToken: string, input: SendMessageInput): Promise<{ providerMessageId: string }> {
    if (!this.useLiveApi()) {
      return this.stub.sendMessage(accessToken, input);
    }
    const apiBase = this.requireMailApiBase();

    const response = await this.requestJson<{ id?: string }>(`${apiBase.replace(/\/$/, "")}/messages/send`, {
      method: "POST",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    return {
      providerMessageId: response.id ?? `yandex-sent-${Date.now()}`
    };
  }

  async createDraft(accessToken: string, input: DraftInput): Promise<{ providerDraftId: string }> {
    if (!this.useLiveApi()) {
      return this.stub.createDraft(accessToken, input);
    }
    const apiBase = this.requireMailApiBase();

    const response = await this.requestJson<{ id?: string }>(`${apiBase.replace(/\/$/, "")}/drafts`, {
      method: "POST",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    return {
      providerDraftId: response.id ?? `yandex-draft-${Date.now()}`
    };
  }

  async updateDraft(accessToken: string, input: DraftInput): Promise<{ providerDraftId: string }> {
    if (!this.useLiveApi()) {
      return this.stub.updateDraft(accessToken, input);
    }
    const apiBase = this.requireMailApiBase();

    if (!input.draftId) {
      return this.createDraft(accessToken, input);
    }

    await this.requestVoid(`${apiBase.replace(/\/$/, "")}/drafts/${encodeURIComponent(input.draftId)}`, {
      method: "PUT",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });

    return {
      providerDraftId: input.draftId
    };
  }

  async deleteMessage(accessToken: string, messageId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.deleteMessage(accessToken, messageId);
    }
    const apiBase = this.requireMailApiBase();

    await this.requestVoid(`${apiBase.replace(/\/$/, "")}/messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE",
      headers: this.authHeaders(accessToken)
    });
  }

  async archiveMessage(accessToken: string, messageId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.archiveMessage(accessToken, messageId);
    }
    const apiBase = this.requireMailApiBase();

    await this.requestVoid(`${apiBase.replace(/\/$/, "")}/messages/${encodeURIComponent(messageId)}/archive`, {
      method: "POST",
      headers: this.authHeaders(accessToken)
    });
  }

  async markRead(accessToken: string, messageId: string, read: boolean): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.markRead(accessToken, messageId, read);
    }
    const apiBase = this.requireMailApiBase();

    await this.requestVoid(`${apiBase.replace(/\/$/, "")}/messages/${encodeURIComponent(messageId)}/read`, {
      method: "POST",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ read })
    });
  }

  async moveMessage(accessToken: string, input: MoveMessageInput): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.moveMessage(accessToken, input);
    }
    const apiBase = this.requireMailApiBase();

    await this.requestVoid(`${apiBase.replace(/\/$/, "")}/messages/${encodeURIComponent(input.messageId)}/move`, {
      method: "POST",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ folderId: input.targetContainerId })
    });
  }

  async addLabel(accessToken: string, messageId: string, labelId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.addLabel(accessToken, messageId, labelId);
    }
    const apiBase = this.requireMailApiBase();

    await this.requestVoid(`${apiBase.replace(/\/$/, "")}/messages/${encodeURIComponent(messageId)}/labels`, {
      method: "POST",
      headers: {
        ...this.authHeaders(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ labelId })
    });
  }

  async removeLabel(accessToken: string, messageId: string, labelId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.removeLabel(accessToken, messageId, labelId);
    }
    const apiBase = this.requireMailApiBase();

    await this.requestVoid(
      `${apiBase.replace(/\/$/, "")}/messages/${encodeURIComponent(messageId)}/labels/${encodeURIComponent(
        labelId
      )}`,
      {
        method: "DELETE",
        headers: this.authHeaders(accessToken)
      }
    );
  }

  async watch(accessToken: string, request: WatchRequest): Promise<WatchResponse> {
    if (!this.useLiveApi()) {
      return this.stub.watch(accessToken, request);
    }
    const apiBase = this.requireMailApiBase();

    const profile = await this.getProfile(accessToken);
    const response = await this.requestJson<{ id?: string; expiresAt?: string }>(
      `${apiBase.replace(/\/$/, "")}/watchers`,
      {
        method: "POST",
        headers: {
          ...this.authHeaders(accessToken),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          callbackUrl: request.webhookUrl,
          mailboxId: request.mailboxId,
          providerAccountId: profile.providerAccountId
        })
      }
    );

    return {
      watchId: response.id ?? `yandex-watch-${Date.now()}`,
      ...(response.expiresAt ? { expiresAt: new Date(response.expiresAt) } : {})
    };
  }

  async stopWatch(accessToken: string, watchId: string): Promise<void> {
    if (!this.useLiveApi()) {
      return this.stub.stopWatch(accessToken, watchId);
    }
    const apiBase = this.requireMailApiBase();

    await this.requestVoid(`${apiBase.replace(/\/$/, "")}/watchers/${encodeURIComponent(watchId)}`, {
      method: "DELETE",
      headers: this.authHeaders(accessToken)
    });
  }

  async getProfile(accessToken: string): Promise<MailboxProfile> {
    if (!this.useLiveApi()) {
      return this.stub.getProfile(accessToken);
    }

    const profile = await this.requestJson<YandexProfileResponse>(YANDEX_PROFILE_URL, {
      headers: this.authHeaders(accessToken)
    });

    const email = profile.default_email;
    if (!email) {
      throw new ProviderError({
        provider: this.provider,
        code: "UNKNOWN",
        message: "Yandex profile default_email alanı boş döndü",
        retryable: false
      });
    }

    return {
      email: email.toLowerCase(),
      ...(profile.real_name ? { displayName: profile.real_name } : {}),
      providerAccountId: profile.id ?? profile.login ?? email.toLowerCase()
    };
  }

  async parseWebhookEvent(input: ParseWebhookInput): Promise<ProviderWebhookEvent[]> {
    const signatureHeader =
      input.headers["x-lexoffice-signature"] ??
      input.headers["x-yandex-signature"] ??
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

    const events = asArray(parsed.events);
    if (events.length > 0) {
      return events
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => {
          const payload = entry as Record<string, unknown>;
          return {
            ...(asString(payload.providerAccountId) ? { providerAccountId: asString(payload.providerAccountId) } : {}),
            ...(asString(payload.mailboxEmail) ? { mailboxEmail: asString(payload.mailboxEmail) } : {}),
            eventType: normalizeWebhookEventType(payload.eventType),
            occurredAt: parseDate(payload.occurredAt) ?? new Date(),
            payload
          } as ProviderWebhookEvent;
        });
    }

    const webhookPayload = parsed as Record<string, unknown>;
    const mailboxEmail = asString(webhookPayload.mailboxEmail) ?? asString(webhookPayload.email);
    const providerAccountId = asString(webhookPayload.providerAccountId) ?? mailboxEmail;

    return [
      {
        ...(providerAccountId ? { providerAccountId } : {}),
        ...(mailboxEmail ? { mailboxEmail } : {}),
        eventType: "MAILBOX_SYNC_REQUIRED",
        occurredAt: new Date(),
        payload: webhookPayload
      }
    ];
  }

  private useLiveApi(): boolean {
    return isLiveProviderEnabled(this.provider);
  }

  private async exchangeAuthorizationCode(code: string, redirectUri: string): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.requireEnv("YANDEX_CLIENT_ID"),
      client_secret: this.requireEnv("YANDEX_CLIENT_SECRET"),
      code,
      redirect_uri: redirectUri
    });

    return this.postToken(body);
  }

  private async postToken(body: URLSearchParams): Promise<OAuthTokenResponse> {
    const token = await retryProviderRequest(
      async () => {
        const response = await fetch(YANDEX_TOKEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body
        });

        if (!response.ok) {
          throw await this.buildHttpError(response);
        }

        return (await response.json()) as OAuthTokenResponse;
      },
      (error) => this.isRetryableError(error)
    );

    if (!token.access_token) {
      throw new ProviderError({
        provider: this.provider,
        code: "UNKNOWN",
        message: "Yandex token endpoint access_token döndürmedi",
        retryable: false
      });
    }

    if (!token.scope && token.id_token) {
      const jwtPayload = decodeJwtPayload(token.id_token);
      const scopeFromJwt = asString(jwtPayload?.scope);
      if (scopeFromJwt) {
        token.scope = scopeFromJwt;
      }
    }

    return token;
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
      Authorization: `OAuth ${accessToken}`
    };
  }

  private requireEnv(key: "YANDEX_CLIENT_ID" | "YANDEX_CLIENT_SECRET"): string {
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

  private requireMailApiBase(): string {
    const value = process.env.YANDEX_MAIL_API_BASE_URL;
    if (!hasValue(value)) {
      throw new ProviderError({
        provider: this.provider,
        code: "INVALID_REQUEST",
        message:
          "YANDEX_MAIL_API_BASE_URL tanımlı değil. Live Yandex operasyonu için vendor endpoint zorunludur.",
        retryable: false
      });
    }

    return value.replace(/\/$/, "");
  }

  private async buildHttpError(response: Response): Promise<ProviderError> {
    let message = `${this.provider} API request başarısız`;

    try {
      const payload = (await response.json()) as {
        error?: string;
        error_description?: string;
        message?: string;
      };

      message = payload.error_description ?? payload.message ?? payload.error ?? message;
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

function clampMaxResults(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return 25;
  }

  return Math.max(1, Math.min(value, 100));
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
