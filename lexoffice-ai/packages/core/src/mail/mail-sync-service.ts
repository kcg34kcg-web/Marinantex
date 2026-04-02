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
import { MailThreadService } from "./mail-thread-service";

type MailPolicyConfig = {
  actorUserId: string | null;
  mailboxEmail: string;
  senderIdentityEmail: string | null;
  autoResponderEnabled: boolean;
  autoResponderSubject: string;
  autoResponderBodyText: string;
  forwardingEnabled: boolean;
  forwardingRecipients: string[];
  forwardingMailboxId: string | null;
  senderListEntries: Array<{
    kind: "WHITELIST" | "BLACKLIST" | "BLOCKED";
    emailOrDomain: string;
  }>;
  filterRules: Array<{
    id: string;
    name: string;
    enabled: boolean;
    priority: number;
    fromPattern: string | null;
    subjectPattern: string | null;
    bodyPattern: string | null;
    hasAttachments: boolean | null;
    actionState: "RECEIVED" | "SENT" | "DRAFT" | "SCHEDULED" | "ARCHIVED" | "TRASH" | "SPAM" | null;
    actionMarkRead: boolean;
    actionStar: boolean;
    actionImportant: boolean;
    actionLabelName: string | null;
    actionForwardTo: string | null;
    stopProcessing: boolean;
  }>;
};

export class MailSyncService {
  private readonly providerRegistry: MailProviderRegistry;
  private readonly providerTokenService: ProviderTokenService;
  private readonly mailThreadService: MailThreadService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {
    this.providerRegistry = new MailProviderRegistry();
    this.providerTokenService = new ProviderTokenService(prisma);
    this.mailThreadService = new MailThreadService(prisma, auditService);
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
    const policyConfig = await this.resolveMailPolicyConfig(tenantId, mailboxId);

    for (const providerMessage of syncResult.messages) {
      const baseClassification = classifyProviderMessage(providerMessage);
      const classification = applySenderListPolicy(
        providerMessage.fromEmail,
        baseClassification,
        policyConfig.senderListEntries
      );
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
        const createdMessage = await this.prisma.mailMessage.create({
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

        const threadUpdated = await this.prisma.mailThread.update({
          where: { id: thread.id },
          data: {
            messageCount: { increment: 1 },
            ...(providerMessage.isRead ? {} : { unreadCount: { increment: 1 } })
          },
          select: {
            id: true,
            unreadCount: true
          }
        });

        const finalMessageState = await this.applyInboundPolicies({
          tenantId,
          mailboxId,
          threadId: thread.id,
          threadUnreadCount: threadUpdated.unreadCount,
          createdMessage,
          providerMessage,
          policyConfig
        });

        try {
          await this.trySendAutoResponder({
            tenantId,
            mailboxId,
            threadId: thread.id,
            inboundMessageId: createdMessage.id,
            inboundFromEmail: providerMessage.fromEmail,
            classificationState: finalMessageState,
            policyConfig
          });
        } catch (error) {
          await this.auditService.log({
            tenantId,
            action: "mail.autoresponder.failed",
            resourceType: "mail_thread",
            resourceId: thread.id,
            metadata: {
              inboundMessageId: createdMessage.id,
              error: error instanceof Error ? error.message : "Bilinmeyen hata"
            }
          });
        }
      }
    }
  }

  private async resolveMailPolicyConfig(
    tenantId: string,
    mailboxId: string
  ): Promise<MailPolicyConfig> {
    const [settings, mailbox, tenant, senderListEntries, filterRules] = await Promise.all([
      this.prisma.tenantSettings.findUnique({
        where: { tenantId },
        select: {
          autoResponderEnabled: true,
          autoResponderSubject: true,
          autoResponderBodyText: true,
          mailForwardingEnabled: true,
          mailForwardingRecipients: true,
          mailForwardingMailboxId: true
        }
      }),
      this.prisma.mailbox.findFirst({
        where: {
          id: mailboxId,
          tenantId,
          deletedAt: null
        },
        select: {
          email: true,
          senderIdentityEmail: true,
          connections: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: {
              userId: true
            }
          }
        }
      }),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { ownerUserId: true }
      }),
      this.prisma.mailSenderListEntry.findMany({
        where: {
          tenantId,
          deletedAt: null
        },
        select: {
          kind: true,
          emailOrDomain: true
        }
      }),
      this.prisma.mailFilterRule.findMany({
        where: {
          tenantId,
          deletedAt: null,
          enabled: true,
          OR: [{ mailboxId: null }, { mailboxId }]
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          enabled: true,
          priority: true,
          fromPattern: true,
          subjectPattern: true,
          bodyPattern: true,
          hasAttachments: true,
          actionState: true,
          actionMarkRead: true,
          actionStar: true,
          actionImportant: true,
          actionLabelName: true,
          actionForwardTo: true,
          stopProcessing: true
        }
      })
    ]);

    return {
      actorUserId: mailbox?.connections[0]?.userId ?? tenant?.ownerUserId ?? null,
      mailboxEmail: mailbox?.email?.trim().toLowerCase() ?? "",
      senderIdentityEmail: mailbox?.senderIdentityEmail?.trim().toLowerCase() ?? null,
      autoResponderEnabled: settings?.autoResponderEnabled ?? false,
      autoResponderSubject: settings?.autoResponderSubject?.trim() ?? "",
      autoResponderBodyText: settings?.autoResponderBodyText?.trim() ?? "",
      forwardingEnabled: settings?.mailForwardingEnabled ?? false,
      forwardingRecipients:
        settings?.mailForwardingRecipients
          .map((value: string) => value.trim().toLowerCase())
          .filter(Boolean) ?? [],
      forwardingMailboxId: settings?.mailForwardingMailboxId ?? null,
      senderListEntries,
      filterRules
    };
  }

  private async applyInboundPolicies(params: {
    tenantId: string;
    mailboxId: string;
    threadId: string;
    threadUnreadCount: number;
    createdMessage: {
      id: string;
      state: "RECEIVED" | "SENT" | "DRAFT" | "SCHEDULED" | "ARCHIVED" | "TRASH" | "SPAM";
      isRead: boolean;
      isStarred: boolean;
      isImportant: boolean;
      subject: string | null;
      snippet: string | null;
      fromEmail: string | null;
      fromName: string | null;
      bodyText: string | null;
      bodyPreview: string | null;
      sentAt: Date | null;
      receivedAt: Date | null;
    };
    providerMessage: ProviderMessage;
    policyConfig: MailPolicyConfig;
  }): Promise<"RECEIVED" | "SENT" | "DRAFT" | "SCHEDULED" | "ARCHIVED" | "TRASH" | "SPAM"> {
    let nextState = params.createdMessage.state;
    let nextRead = params.createdMessage.isRead;
    let nextStarred = params.createdMessage.isStarred;
    let nextImportant = params.createdMessage.isImportant;
    const labelNames: string[] = [];
    const forwardRecipients: string[] = [];

    for (const rule of params.policyConfig.filterRules) {
      if (!matchesFilterRule(rule, params.providerMessage)) {
        continue;
      }

      if (rule.actionState) {
        nextState = rule.actionState;
      }
      if (rule.actionMarkRead) {
        nextRead = true;
      }
      if (rule.actionStar) {
        nextStarred = true;
      }
      if (rule.actionImportant) {
        nextImportant = true;
      }
      if (rule.actionLabelName) {
        labelNames.push(rule.actionLabelName);
      }
      if (rule.actionForwardTo) {
        forwardRecipients.push(rule.actionForwardTo);
      }

      if (rule.stopProcessing) {
        break;
      }
    }

    if (
      params.policyConfig.forwardingEnabled &&
      (params.policyConfig.forwardingMailboxId === null ||
        params.policyConfig.forwardingMailboxId === params.mailboxId)
    ) {
      forwardRecipients.push(...params.policyConfig.forwardingRecipients);
    }

    const uniqueLabelNames = [...new Set(labelNames.map((name) => name.trim()).filter(Boolean))];
    const uniqueForwardRecipients = [
      ...new Set(forwardRecipients.map((email) => email.trim().toLowerCase()).filter(Boolean))
    ];

    const shouldUpdateMessage =
      nextState !== params.createdMessage.state ||
      nextRead !== params.createdMessage.isRead ||
      nextStarred !== params.createdMessage.isStarred ||
      nextImportant !== params.createdMessage.isImportant;

    if (shouldUpdateMessage) {
      await this.prisma.mailMessage.update({
        where: {
          id: params.createdMessage.id
        },
        data: {
          state: nextState,
          isRead: nextRead,
          isStarred: nextStarred,
          isImportant: nextImportant
        }
      });
    }

    if (!params.createdMessage.isRead && nextRead && params.threadUnreadCount > 0) {
      await this.prisma.mailThread.update({
        where: { id: params.threadId },
        data: {
          unreadCount: {
            decrement: 1
          }
        }
      });
    }

    for (const labelName of uniqueLabelNames) {
      const label = await this.prisma.mailLabel.upsert({
        where: {
          tenantId_mailboxId_name: {
            tenantId: params.tenantId,
            mailboxId: params.mailboxId,
            name: labelName
          }
        },
        create: {
          tenantId: params.tenantId,
          mailboxId: params.mailboxId,
          name: labelName,
          type: "LABEL",
          isSystem: false
        },
        update: {},
        select: {
          id: true
        }
      });

      await this.prisma.mailMessageLabel.upsert({
        where: {
          messageId_labelId: {
            messageId: params.createdMessage.id,
            labelId: label.id
          }
        },
        create: {
          tenantId: params.tenantId,
          messageId: params.createdMessage.id,
          labelId: label.id
        },
        update: {}
      });
    }

    if (
      uniqueForwardRecipients.length > 0 &&
      nextState !== "SPAM" &&
      nextState !== "TRASH" &&
      params.policyConfig.actorUserId
    ) {
      const forwardedBodyText = buildForwardedBodyText({
        subject: params.createdMessage.subject,
        fromEmail: params.createdMessage.fromEmail ?? params.providerMessage.fromEmail,
        fromName: params.createdMessage.fromName,
        sentAt: params.createdMessage.sentAt ?? params.createdMessage.receivedAt ?? new Date(),
        bodyText: params.createdMessage.bodyText ?? params.createdMessage.bodyPreview ?? params.providerMessage.snippet ?? ""
      });

      await this.mailThreadService.sendMessage(params.policyConfig.actorUserId, {
        tenantId: params.tenantId,
        mailboxId: params.mailboxId,
        subject: `Fwd: ${params.createdMessage.subject ?? "(Konu yok)"}`,
        bodyText: forwardedBodyText,
        toRecipients: uniqueForwardRecipients,
        ccRecipients: [],
        bccRecipients: [],
        attachments: []
      });
    }

    return nextState;
  }

  private async trySendAutoResponder(params: {
    tenantId: string;
    mailboxId: string;
    threadId: string;
    inboundMessageId: string;
    inboundFromEmail: string;
    classificationState: "RECEIVED" | "SENT" | "DRAFT" | "SCHEDULED" | "ARCHIVED" | "TRASH" | "SPAM";
    policyConfig: MailPolicyConfig;
  }): Promise<void> {
    const config = params.policyConfig;
    const fromEmail = params.inboundFromEmail.trim().toLowerCase();

    if (params.classificationState !== "RECEIVED") {
      return;
    }

    if (
      !config.autoResponderEnabled ||
      config.autoResponderSubject.length === 0 ||
      config.autoResponderBodyText.length === 0
    ) {
      return;
    }

    if (!config.actorUserId || fromEmail.length === 0) {
      return;
    }

    if (fromEmail === config.mailboxEmail || fromEmail === config.senderIdentityEmail) {
      return;
    }

    if (isNoReplyAddress(fromEmail)) {
      return;
    }

    const existingOutboundMessages = await this.prisma.mailMessage.findMany({
      where: {
        tenantId: params.tenantId,
        threadId: params.threadId,
        direction: "OUTBOUND",
        deletedAt: null
      },
      select: {
        providerRawPayload: true
      }
    });

    if (existingOutboundMessages.some((message) => isAutoResponderPayload(message.providerRawPayload))) {
      return;
    }

    const sent = await this.mailThreadService.sendMessage(config.actorUserId, {
      tenantId: params.tenantId,
      mailboxId: params.mailboxId,
      threadId: params.threadId,
      inReplyToMessageId: params.inboundMessageId,
      subject: config.autoResponderSubject,
      bodyText: config.autoResponderBodyText,
      toRecipients: [fromEmail],
      ccRecipients: [],
      bccRecipients: [],
      attachments: []
    });

    await this.prisma.mailMessage.update({
      where: {
        id: sent.messageId
      },
      data: {
        providerRawPayload: {
          autoResponder: true,
          triggerMessageId: params.inboundMessageId
        }
      }
    });
  }
}

function isAutoResponderPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const raw = value as Record<string, unknown>;
  return raw.autoResponder === true;
}

function isNoReplyAddress(email: string): boolean {
  const [localPart] = email.split("@");
  const normalizedLocalPart = (localPart ?? "").toLowerCase();
  return /(^no[-_.]?reply$)|(^do[-_.]?not[-_.]?reply$)|(^mailer-daemon$)/.test(
    normalizedLocalPart
  );
}

function applySenderListPolicy(
  fromEmail: string,
  classification: {
    state: "RECEIVED" | "SENT" | "ARCHIVED" | "TRASH" | "SPAM";
    spamSignals: string[];
    phishingSignals: string[];
  },
  entries: Array<{
    kind: "WHITELIST" | "BLACKLIST" | "BLOCKED";
    emailOrDomain: string;
  }>
): {
  state: "RECEIVED" | "SENT" | "ARCHIVED" | "TRASH" | "SPAM";
  spamSignals: string[];
  phishingSignals: string[];
} {
  const normalizedEmail = fromEmail.trim().toLowerCase();
  const matchedKinds = entries
    .filter((entry) => matchesSenderEntry(entry.emailOrDomain, normalizedEmail))
    .map((entry) => entry.kind);

  if (matchedKinds.includes("WHITELIST")) {
    return {
      ...classification,
      state: "RECEIVED"
    };
  }

  if (matchedKinds.includes("BLACKLIST") || matchedKinds.includes("BLOCKED")) {
    return {
      ...classification,
      state: "SPAM",
      spamSignals: [...classification.spamSignals, "sender_list_policy"]
    };
  }

  return classification;
}

function matchesSenderEntry(emailOrDomain: string, senderEmail: string): boolean {
  const normalized = emailOrDomain.trim().toLowerCase();
  if (normalized.startsWith("@")) {
    return senderEmail.endsWith(normalized);
  }

  return senderEmail === normalized;
}

function matchesFilterRule(
  rule: {
    fromPattern: string | null;
    subjectPattern: string | null;
    bodyPattern: string | null;
    hasAttachments: boolean | null;
  },
  providerMessage: ProviderMessage
): boolean {
  const fromText = `${providerMessage.fromName ?? ""} ${providerMessage.fromEmail}`.toLowerCase();
  const subjectText = (providerMessage.subject ?? "").toLowerCase();
  const bodyText = (providerMessage.snippet ?? "").toLowerCase();

  if (rule.fromPattern && !fromText.includes(rule.fromPattern.toLowerCase())) {
    return false;
  }

  if (rule.subjectPattern && !subjectText.includes(rule.subjectPattern.toLowerCase())) {
    return false;
  }

  if (rule.bodyPattern && !bodyText.includes(rule.bodyPattern.toLowerCase())) {
    return false;
  }

  if (rule.hasAttachments === true) {
    return false;
  }

  return true;
}

function buildForwardedBodyText(input: {
  subject: string | null;
  fromEmail: string;
  fromName: string | null;
  sentAt: Date;
  bodyText: string;
}): string {
  const header = [
    "İleri yönlendirilen mesaj",
    `Kimden: ${input.fromName ? `${input.fromName} <${input.fromEmail}>` : input.fromEmail}`,
    `Tarih: ${input.sentAt.toISOString()}`,
    `Konu: ${input.subject ?? "(Konu yok)"}`
  ].join("\n");

  return `${header}\n\n${input.bodyText}`;
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
