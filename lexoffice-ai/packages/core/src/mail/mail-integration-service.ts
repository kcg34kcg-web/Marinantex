import type { PrismaClient } from "@lexoffice/db";
import { MailProviderRegistry, type SupportedMailProvider } from "@lexoffice/mail";
import { AuditService } from "../audit/audit-service";
import { AppError } from "../errors/app-error";
import { MailboxService } from "./mailbox-service";

export type BuildOAuthUrlInput = {
  provider: SupportedMailProvider;
  redirectUri: string;
  state: string;
  emailHint?: string;
};

export type ConnectMailboxFromOAuthInput = {
  tenantId: string;
  actorUserId: string;
  provider: SupportedMailProvider;
  redirectUri: string;
  authCode: string;
};

export type IngestWebhookInput = {
  provider: SupportedMailProvider;
  rawBody: string;
  headers: Record<string, string | undefined>;
};

export type IngestWebhookResult = {
  eventCount: number;
  syncTargets: Array<{
    tenantId: string;
    mailboxId: string;
    providerAccountId: string;
  }>;
};

export class MailIntegrationService {
  private readonly providerRegistry: MailProviderRegistry;
  private readonly mailboxService: MailboxService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {
    this.providerRegistry = new MailProviderRegistry();
    this.mailboxService = new MailboxService(prisma, auditService);
  }

  buildOAuthAuthorizationUrl(input: BuildOAuthUrlInput): string {
    const adapter = this.providerRegistry.get(input.provider);
    return adapter.buildAuthorizationUrl({
      redirectUri: input.redirectUri,
      state: input.state,
      ...(input.emailHint ? { loginHint: input.emailHint } : {})
    });
  }

  async connectMailboxFromOAuth(input: ConnectMailboxFromOAuthInput) {
    const adapter = this.providerRegistry.get(input.provider);
    const authResult = await adapter.connect(input.authCode, input.redirectUri);
    const profile = await adapter.getProfile(authResult.accessToken);

    const mailbox = await this.mailboxService.connectMailbox(input.actorUserId, {
      tenantId: input.tenantId,
      provider: input.provider,
      email: profile.email,
      displayName: profile.displayName,
      providerAccountId: authResult.providerAccountId || profile.providerAccountId,
      accessToken: authResult.accessToken,
      ...(authResult.refreshToken ? { refreshToken: authResult.refreshToken } : {}),
      scopes: authResult.scopes.length > 0 ? authResult.scopes : ["mail.read"]
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "mailbox.oauth.connected",
      resourceType: "mailbox",
      resourceId: mailbox.id,
      metadata: {
        provider: input.provider,
        providerAccountId: authResult.providerAccountId
      }
    });

    return { mailbox, profile, authResult };
  }

  async ingestWebhook(input: IngestWebhookInput): Promise<IngestWebhookResult> {
    const adapter = this.providerRegistry.get(input.provider);
    const secret = resolveWebhookSecret(input.provider);
    if (isProviderRunningLive(input.provider) && !isNonEmptyString(secret)) {
      throw new AppError(
        "WEBHOOK_SECRET_MISSING",
        `${input.provider} webhook secret tanımlı değil. Canlı webhook trafiği imzasız kabul edilmez.`,
        500
      );
    }
    const events = await adapter.parseWebhookEvent({
      rawBody: input.rawBody,
      headers: input.headers,
      ...(secret ? { secret } : {})
    });

    const providerAccountIds = [
      ...new Set(events.map((event) => event.providerAccountId).filter(isNonEmptyString))
    ];
    const mailboxEmails = [...new Set(events.map((event) => event.mailboxEmail).filter(isNonEmptyString))];

    if (providerAccountIds.length === 0 && mailboxEmails.length === 0) {
      return {
        eventCount: events.length,
        syncTargets: []
      };
    }

    const connections = await this.prisma.mailboxConnection.findMany({
      where: {
        provider: input.provider,
        OR: [
          ...(providerAccountIds.length > 0
            ? [
                {
                  providerAccountId: {
                    in: providerAccountIds
                  }
                }
              ]
            : []),
          ...(mailboxEmails.length > 0
            ? [
                {
                  mailbox: {
                    email: {
                      in: mailboxEmails.map((email) => email.toLowerCase())
                    }
                  }
                }
              ]
            : [])
        ]
      },
      select: {
        tenantId: true,
        mailboxId: true,
        providerAccountId: true
      }
    });

    const syncTargetsMap = new Map<
      string,
      { tenantId: string; mailboxId: string; providerAccountId: string }
    >();
    for (const connection of connections) {
      syncTargetsMap.set(`${connection.tenantId}:${connection.mailboxId}`, connection);
    }

    const syncTargets = [...syncTargetsMap.values()];
    for (const target of syncTargets) {
      await this.auditService.log({
        tenantId: target.tenantId,
        action: "mail.webhook.received",
        resourceType: "mailbox",
        resourceId: target.mailboxId,
        metadata: {
          provider: input.provider,
          providerAccountId: target.providerAccountId,
          eventCount: events.length
        }
      });
    }

    return {
      eventCount: events.length,
      syncTargets
    };
  }
}

function resolveWebhookSecret(provider: SupportedMailProvider): string | undefined {
  if (provider === "GMAIL") {
    return process.env.GMAIL_WEBHOOK_SECRET;
  }

  if (provider === "MICROSOFT_365") {
    return process.env.MICROSOFT_WEBHOOK_SECRET;
  }

  if (provider === "YANDEX") {
    return process.env.YANDEX_WEBHOOK_SECRET;
  }

  return process.env.IMAP_SMTP_WEBHOOK_SECRET;
}

function isProviderRunningLive(provider: SupportedMailProvider): boolean {
  if (process.env.MAIL_PROVIDER_FORCE_STUB === "true") {
    return false;
  }

  if (process.env.MAIL_PROVIDER_LIVE === "false") {
    return false;
  }

  if (process.env.MAIL_PROVIDER_LIVE === "true") {
    return true;
  }

  if (provider === "GMAIL") {
    return hasValue(process.env.GMAIL_CLIENT_ID) && hasValue(process.env.GMAIL_CLIENT_SECRET);
  }

  if (provider === "MICROSOFT_365") {
    return hasValue(process.env.MICROSOFT_CLIENT_ID) && hasValue(process.env.MICROSOFT_CLIENT_SECRET);
  }

  if (provider === "YANDEX") {
    return hasValue(process.env.YANDEX_CLIENT_ID) && hasValue(process.env.YANDEX_CLIENT_SECRET);
  }

  return hasValue(process.env.IMAP_SMTP_WEBHOOK_SECRET);
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
