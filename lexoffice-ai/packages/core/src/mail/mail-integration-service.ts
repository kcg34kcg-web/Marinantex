import type { PrismaClient } from "@lexoffice/db";
import { MailProviderRegistry, type SupportedMailProvider } from "@lexoffice/mail";
import { AuditService } from "../audit/audit-service";
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
    const events = await adapter.parseWebhookEvent({
      rawBody: input.rawBody,
      headers: input.headers,
      ...(secret ? { secret } : {})
    });

    const providerAccountIds = [
      ...new Set(events.map((event) => event.providerAccountId).filter(isNonEmptyString))
    ];
    if (providerAccountIds.length === 0) {
      return {
        eventCount: events.length,
        syncTargets: []
      };
    }

    const connections = await this.prisma.mailboxConnection.findMany({
      where: {
        provider: input.provider,
        providerAccountId: {
          in: providerAccountIds
        }
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

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
