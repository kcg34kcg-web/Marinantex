import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@lexoffice/db";
import type { MailProviderAdapter, ProviderMessage, SyncResult } from "@lexoffice/mail";
import { MailProviderRegistry } from "@lexoffice/mail";
import {
  mailSyncJobSchema,
  triggerSyncSchema,
  type TriggerSyncInput,
  type MailSyncJobPayload
} from "@lexoffice/contracts";
import { NotFoundError } from "../errors/app-error";
import { AuditService } from "../audit/audit-service";
import { QUEUES } from "../jobs/queue-constants";
import { ProviderTokenService } from "./provider-token-service";

export class MailSyncService {
  private readonly providerRegistry: MailProviderRegistry;
  private readonly providerTokenService: ProviderTokenService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {
    this.providerRegistry = new MailProviderRegistry();
    this.providerTokenService = new ProviderTokenService(prisma);
  }

  async triggerSync(actorUserId: string | undefined, payload: TriggerSyncInput) {
    const input = triggerSyncSchema.parse(payload);

    const mailbox = await this.prisma.mailbox.findFirst({
      where: {
        id: input.mailboxId,
        tenantId: input.tenantId,
        deletedAt: null
      }
    });

    if (!mailbox) {
      throw new NotFoundError("Mailbox bulunamadı");
    }

    const existingJob = await this.prisma.backgroundJob.findFirst({
      where: {
        tenantId: input.tenantId,
        jobType: "mail.sync",
        queueName: QUEUES.MAIL_SYNC,
        status: {
          in: ["QUEUED", "RUNNING"]
        },
        payload: {
          path: ["mailboxId"],
          equals: input.mailboxId
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (existingJob?.payload) {
      const payloadJson =
        typeof existingJob.payload === "string"
          ? JSON.parse(existingJob.payload)
          : existingJob.payload;

      const existingPayload = mailSyncJobSchema.safeParse(payloadJson);
      if (existingPayload.success) {
        return existingPayload.data;
      }
    }

    const correlationId = randomUUID();

    const jobPayload = mailSyncJobSchema.parse({
      tenantId: input.tenantId,
      mailboxId: input.mailboxId,
      ...(actorUserId ? { triggeredByUserId: actorUserId } : {}),
      mode: input.mode,
      correlationId
    });

    await this.prisma.backgroundJob.create({
      data: {
        tenantId: input.tenantId,
        jobType: "mail.sync",
        queueName: QUEUES.MAIL_SYNC,
        status: "QUEUED",
        payload: jobPayload,
        correlationId,
        runAt: new Date()
      }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      ...(actorUserId ? { actorUserId } : {}),
      action: "mail.sync.queued",
      resourceType: "mailbox",
      resourceId: input.mailboxId,
      metadata: jobPayload
    });

    return jobPayload;
  }

  async runSyncJob(
    payload: MailSyncJobPayload
  ): Promise<{ syncedMessages: number; correlationId: string }> {
    const job = mailSyncJobSchema.parse(payload);

    const mailbox = await this.prisma.mailbox.findFirst({
      where: {
        id: job.mailboxId,
        tenantId: job.tenantId,
        deletedAt: null
      },
      include: {
        connections: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    if (!mailbox) {
      throw new NotFoundError("Sync için mailbox bulunamadı");
    }

    await this.prisma.backgroundJob.updateMany({
      where: {
        correlationId: job.correlationId,
        queueName: QUEUES.MAIL_SYNC,
        status: {
          in: ["QUEUED", "FAILED"]
        }
      },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        attempts: {
          increment: 1
        }
      }
    });

    await this.prisma.mailboxSyncState.upsert({
      where: {
        mailboxId_provider: {
          mailboxId: mailbox.id,
          provider: mailbox.provider
        }
      },
      create: {
        tenantId: mailbox.tenantId,
        mailboxId: mailbox.id,
        provider: mailbox.provider,
        syncStatus: "RUNNING",
        lastSyncStartedAt: new Date()
      },
      update: {
        syncStatus: "RUNNING",
        lastSyncStartedAt: new Date(),
        lastError: null
      }
    });

    try {
      const connection = mailbox.connections[0];
      let syncResult: SyncResult;
      const forceMock = process.env.MAIL_SYNC_MOCK === "true";

      if (forceMock || !connection || mailbox.provider === "MANAGED") {
        syncResult = this.createMockSyncResult(mailbox.id);
      } else {
        const adapter = this.providerRegistry.get(mailbox.provider);
        const accessToken = await this.providerTokenService.resolveAccessToken(connection);
        syncResult = await this.syncViaAdapter(adapter, accessToken, mailbox.id);
      }

      await this.persistSyncResult(mailbox.tenantId, mailbox.id, syncResult);

      await this.prisma.mailboxSyncState.update({
        where: {
          mailboxId_provider: {
            mailboxId: mailbox.id,
            provider: mailbox.provider
          }
        },
        data: {
          syncStatus: "IDLE",
          syncCursor: syncResult.nextCursor ?? null,
          lastSyncedAt: new Date(),
          lastSyncEndedAt: new Date(),
          lastError: null,
          consecutiveErrors: 0
        }
      });

      await this.auditService.log({
        tenantId: mailbox.tenantId,
        ...(job.triggeredByUserId ? { actorUserId: job.triggeredByUserId } : {}),
        action: "mail.sync.completed",
        resourceType: "mailbox",
        resourceId: mailbox.id,
        metadata: {
          mode: job.mode,
          syncedMessages: syncResult.messages.length,
          correlationId: job.correlationId
        }
      });

      return {
        syncedMessages: syncResult.messages.length,
        correlationId: job.correlationId
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bilinmeyen senkron hatası";

      await this.prisma.mailboxSyncState.update({
        where: {
          mailboxId_provider: {
            mailboxId: mailbox.id,
            provider: mailbox.provider
          }
        },
        data: {
          syncStatus: "FAILED",
          lastSyncEndedAt: new Date(),
          lastError: message,
          consecutiveErrors: {
            increment: 1
          }
        }
      });

      await this.auditService.log({
        tenantId: mailbox.tenantId,
        ...(job.triggeredByUserId ? { actorUserId: job.triggeredByUserId } : {}),
        action: "mail.sync.failed",
        resourceType: "mailbox",
        resourceId: mailbox.id,
        metadata: {
          correlationId: job.correlationId,
          error: message
        }
      });

      throw error;
    }
  }

  private async syncViaAdapter(
    adapter: MailProviderAdapter,
    accessToken: string,
    mailboxId: string
  ): Promise<SyncResult> {
    return adapter.syncMessages(accessToken, {
      mailboxId,
      maxResults: 25
    });
  }

  private createMockSyncResult(mailboxId: string): SyncResult {
    const now = new Date();
    const messageId = randomUUID();

    const message: ProviderMessage = {
      id: `mock-${messageId}`,
      threadId: `mock-thread-${mailboxId}`,
      subject: "LexOffice AI Hoş Geldiniz",
      snippet: "Domain ve mailbox yapılandırmasını tamamlamak için sihirbazı takip edin.",
      fromEmail: "noreply@lexoffice.ai",
      fromName: "LexOffice AI",
      sentAt: now,
      receivedAt: now,
      isRead: false,
      isStarred: false,
      labelsOrFolders: ["INBOX"]
    };

    return {
      messages: [message],
      nextCursor: now.toISOString(),
      hasMore: false
    };
  }

  private async persistSyncResult(
    tenantId: string,
    mailboxId: string,
    syncResult: SyncResult
  ): Promise<void> {
    for (const providerMessage of syncResult.messages) {
      const classification = classifyProviderMessage(providerMessage);
      const thread = await this.prisma.mailThread.upsert({
        where: {
          tenantId_mailboxId_providerThreadId: {
            tenantId,
            mailboxId,
            providerThreadId: providerMessage.threadId
          }
        },
        create: {
          tenantId,
          mailboxId,
          providerThreadId: providerMessage.threadId,
          subject: providerMessage.subject ?? null,
          normalizedSubject: providerMessage.subject?.toLowerCase() ?? null,
          snippet: providerMessage.snippet ?? null,
          messageCount: 0,
          unreadCount: 0,
          lastMessageAt: providerMessage.receivedAt ?? providerMessage.sentAt ?? new Date()
        },
        update: {
          subject: providerMessage.subject ?? null,
          normalizedSubject: providerMessage.subject?.toLowerCase() ?? null,
          snippet: providerMessage.snippet ?? null,
          lastMessageAt: providerMessage.receivedAt ?? providerMessage.sentAt ?? new Date()
        }
      });

      const existingMessage = await this.prisma.mailMessage.findUnique({
        where: {
          tenantId_mailboxId_providerMessageId: {
            tenantId,
            mailboxId,
            providerMessageId: providerMessage.id
          }
        }
      });

      if (!existingMessage) {
        await this.prisma.mailMessage.create({
          data: {
            tenantId,
            mailboxId,
            threadId: thread.id,
            providerMessageId: providerMessage.id,
            direction: "INBOUND",
            state: classification.state,
            subject: providerMessage.subject ?? null,
            snippet: providerMessage.snippet ?? null,
            bodyText: providerMessage.snippet ?? null,
            bodyPreview: providerMessage.snippet ?? null,
            fromEmail: providerMessage.fromEmail ?? null,
            fromName: providerMessage.fromName ?? null,
            sentAt: providerMessage.sentAt ?? null,
            receivedAt: providerMessage.receivedAt ?? null,
            isRead: providerMessage.isRead,
            isStarred: providerMessage.isStarred,
            providerRawPayload: {
              labelsOrFolders: providerMessage.labelsOrFolders,
              classification
            }
          }
        });

        await this.prisma.mailThread.update({
          where: { id: thread.id },
          data: {
            messageCount: { increment: 1 },
            ...(providerMessage.isRead ? {} : { unreadCount: { increment: 1 } })
          }
        });
      }
    }
  }
}

function classifyProviderMessage(providerMessage: ProviderMessage): {
  state: "RECEIVED" | "SENT" | "ARCHIVED" | "TRASH" | "SPAM";
  spamSignals: string[];
  phishingSignals: string[];
} {
  const normalizedLabels = providerMessage.labelsOrFolders.map((label) => label.toLowerCase());
  const spamSignals: string[] = [];
  const phishingSignals: string[] = [];
  const searchableText = `${providerMessage.subject ?? ""} ${providerMessage.snippet ?? ""}`.toLowerCase();

  if (matchesLabel(normalizedLabels, ["spam", "junk", "phishing"])) {
    spamSignals.push("provider_spam_container");
    return {
      state: "SPAM",
      spamSignals,
      phishingSignals
    };
  }

  if (matchesLabel(normalizedLabels, ["trash", "deleted", "bin"])) {
    return {
      state: "TRASH",
      spamSignals,
      phishingSignals
    };
  }

  if (matchesLabel(normalizedLabels, ["sent"])) {
    return {
      state: "SENT",
      spamSignals,
      phishingSignals
    };
  }

  if (matchesLabel(normalizedLabels, ["archive", "allmail", "all_mail"])) {
    return {
      state: "ARCHIVED",
      spamSignals,
      phishingSignals
    };
  }

  const spamKeywordPatterns = [
    "act now",
    "free money",
    "winner",
    "lottery",
    "urgent transfer",
    "bitcoin",
    "claim reward",
    "kazandınız",
    "ödül",
    "hemen tıkla"
  ];
  const phishingPatterns = [
    "verify account",
    "password reset",
    "confirm identity",
    "suspended account",
    "security alert",
    "hesabınızı doğrulayın",
    "şifre sıfırlama",
    "kimlik doğrula"
  ];

  const spamKeywordHit = spamKeywordPatterns.some((keyword) => searchableText.includes(keyword));
  if (spamKeywordHit) {
    spamSignals.push("spam_keyword_pattern");
  }

  const phishingHit = phishingPatterns.some((keyword) => searchableText.includes(keyword));
  if (phishingHit) {
    phishingSignals.push("phishing_keyword_pattern");
  }

  const sender = providerMessage.fromEmail.toLowerCase();
  if (sender.includes("+") || sender.includes("noreply")) {
    spamSignals.push("sender_pattern");
  }

  if (spamSignals.length >= 2 || (spamSignals.length > 0 && phishingSignals.length > 0)) {
    return {
      state: "SPAM",
      spamSignals,
      phishingSignals
    };
  }

  return {
    state: "RECEIVED",
    spamSignals,
    phishingSignals
  };
}

function matchesLabel(labels: string[], patterns: string[]): boolean {
  return labels.some((label) => patterns.some((pattern) => label.includes(pattern)));
}
