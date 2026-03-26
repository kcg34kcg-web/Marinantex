import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@lexoffice/db";
import { MailProviderRegistry } from "@lexoffice/mail";
import {
  cancelScheduledSendSchema,
  createMailLabelSchema,
  createDraftSchema,
  linkThreadToMatterSchema,
  scheduledMailSendJobSchema,
  scheduleSendMailSchema,
  sendMailSchema,
  getThreadSchema,
  listThreadsSchema,
  markMessageReadSchema,
  toggleMessageLabelSchema,
  updateMessageFlagsSchema,
  updateMessageStateSchema,
  type LinkThreadToMatterInput,
  type ListThreadsInput
} from "@lexoffice/contracts";
import { ConflictError, NotFoundError } from "../errors/app-error";
import { AuditService } from "../audit/audit-service";
import { JOB_NAMES, QUEUES } from "../jobs/queue-constants";
import { ProviderTokenService } from "./provider-token-service";
import { AttachmentSecurityService } from "./attachment-security-service";

type MailboxConnectionTokenSnapshot = {
  id: string;
  provider: "GMAIL" | "MICROSOFT_365" | "YANDEX" | "IMAP_SMTP" | "MANAGED";
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
};

type ThreadListMessage = {
  id: string;
  fromEmail: string | null;
  fromName: string | null;
  snippet: string | null;
  isRead: boolean;
  isSensitive: boolean;
  isStarred: boolean;
  isImportant: boolean;
  state: "RECEIVED" | "SENT" | "DRAFT" | "SCHEDULED" | "ARCHIVED" | "TRASH" | "SPAM";
  direction: "INBOUND" | "OUTBOUND";
  receivedAt: Date | null;
  sentAt: Date | null;
};

type ThreadListItem = {
  id: string;
  tenantId: string;
  mailboxId: string;
  subject: string | null;
  snippet: string | null;
  unreadCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  kind: "THREAD" | "DRAFT";
  draftId: string | null;
  mailbox: {
    id: string;
    email: string;
    displayName: string | null;
    provider: "GMAIL" | "MICROSOFT_365" | "YANDEX" | "IMAP_SMTP" | "MANAGED";
  } | null;
  messages: ThreadListMessage[];
};

export class MailThreadService {
  private readonly providerRegistry: MailProviderRegistry;
  private readonly providerTokenService: ProviderTokenService;
  private readonly attachmentSecurityService: AttachmentSecurityService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {
    this.providerRegistry = new MailProviderRegistry();
    this.providerTokenService = new ProviderTokenService(prisma);
    this.attachmentSecurityService = new AttachmentSecurityService(prisma, auditService);
  }

  async listThreads(payload: ListThreadsInput) {
    const input = listThreadsSchema.parse(payload);
    const normalizedQuery = input.query?.trim() || undefined;

    if (input.view === "label" && !input.labelId) {
      return {
        threads: [] as ThreadListItem[],
        nextCursor: null
      };
    }

    if (input.view === "drafts") {
      return this.listDraftThreads(input);
    }

    const messageFilter = buildMessageFilter(input);
    const messageQueryFilter = normalizedQuery ? buildMessageQueryFilter(normalizedQuery) : undefined;
    const cursorField = input.sortDirection === "asc" ? "gt" : "lt";

    const threads = await this.prisma.mailThread.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
        ...(normalizedQuery
          ? {
              OR: [
                { subject: { contains: normalizedQuery, mode: "insensitive" } },
                { snippet: { contains: normalizedQuery, mode: "insensitive" } },
                {
                  messages: {
                    some: {
                      ...messageFilter,
                      ...(messageQueryFilter ?? {})
                    }
                  }
                }
              ]
            }
          : {}),
        ...(input.cursor
          ? {
              lastMessageAt: {
                [cursorField]: new Date(input.cursor)
              }
            }
          : {}),
        messages: {
          some: messageFilter
        }
      },
      take: input.limit,
      orderBy: [{ lastMessageAt: input.sortDirection }, { createdAt: input.sortDirection }],
      include: {
        mailbox: {
          select: {
            id: true,
            email: true,
            displayName: true,
            provider: true
          }
        },
        messages: {
          where: messageFilter,
          take: 1,
          orderBy: [{ receivedAt: "desc" }, { sentAt: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            fromEmail: true,
            fromName: true,
            snippet: true,
            isRead: true,
            isSensitive: true,
            isStarred: true,
            isImportant: true,
            state: true,
            direction: true,
            receivedAt: true,
            sentAt: true
          }
        }
      }
    });

    const normalizedThreads: ThreadListItem[] = threads.map((thread) => ({
      id: thread.id,
      tenantId: thread.tenantId,
      mailboxId: thread.mailboxId,
      subject: thread.subject,
      snippet: thread.snippet,
      unreadCount: thread.unreadCount,
      lastMessageAt: thread.lastMessageAt ?? null,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      kind: "THREAD",
      draftId: null,
      mailbox: thread.mailbox,
      messages: thread.messages.map((message) => ({
        id: message.id,
        fromEmail: message.fromEmail,
        fromName: message.fromName,
        snippet: message.snippet,
        isRead: message.isRead,
        isSensitive: message.isSensitive,
        isStarred: message.isStarred,
        isImportant: message.isImportant,
        state: message.state,
        direction: message.direction,
        receivedAt: message.receivedAt,
        sentAt: message.sentAt
      }))
    }));

    const lastThread = normalizedThreads.at(-1);
    const nextCursor =
      normalizedThreads.length === input.limit && lastThread?.lastMessageAt
        ? lastThread.lastMessageAt.toISOString()
        : null;

    return {
      threads: normalizedThreads,
      nextCursor
    };
  }

  private async listDraftThreads(input: ReturnType<typeof listThreadsSchema.parse>) {
    const cursorField = input.sortDirection === "asc" ? "gt" : "lt";

    const drafts = await this.prisma.draft.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
        ...(input.query
          ? {
              OR: [
                { subject: { contains: input.query, mode: "insensitive" } },
                { bodyText: { contains: input.query, mode: "insensitive" } },
                { bodyHtml: { contains: input.query, mode: "insensitive" } }
              ]
            }
          : {}),
        ...(input.cursor
          ? {
              updatedAt: {
                [cursorField]: new Date(input.cursor)
              }
            }
          : {})
      },
      include: {
        mailbox: {
          select: {
            id: true,
            email: true,
            displayName: true,
            provider: true
          }
        }
      },
      orderBy: [{ updatedAt: input.sortDirection }, { createdAt: input.sortDirection }],
      take: input.limit
    });

    const threads: ThreadListItem[] = drafts.map((draft) => {
      const draftTimestamp = draft.lastAutosavedAt ?? draft.updatedAt;
      const preview = buildBodyPreview(draft.bodyText ?? undefined, draft.bodyHtml ?? undefined);

      return {
        id: `draft:${draft.id}`,
        tenantId: draft.tenantId,
        mailboxId: draft.mailboxId,
        subject: draft.subject,
        snippet: preview,
        unreadCount: 0,
        lastMessageAt: draftTimestamp,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        kind: "DRAFT",
        draftId: draft.id,
        mailbox: draft.mailbox,
        messages: [
          {
            id: `draft-message:${draft.id}`,
            fromEmail: draft.mailbox.email,
            fromName: draft.mailbox.displayName ?? draft.mailbox.email,
            snippet: preview,
            isRead: true,
            isSensitive: false,
            isStarred: false,
            isImportant: false,
            state: "DRAFT",
            direction: "OUTBOUND",
            receivedAt: draftTimestamp,
            sentAt: draftTimestamp
          }
        ]
      };
    });

    const lastThread = threads.at(-1);
    const nextCursor =
      threads.length === input.limit && lastThread?.updatedAt ? lastThread.updatedAt.toISOString() : null;

    return {
      threads,
      nextCursor
    };
  }

  async getThread(tenantId: string, threadId: string) {
    const input = getThreadSchema.parse({ tenantId, threadId });

    const thread = await this.prisma.mailThread.findFirst({
      where: {
        id: input.threadId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      include: {
        mailbox: {
          select: {
            id: true,
            email: true,
            displayName: true,
            provider: true
          }
        },
        matter: {
          select: {
            id: true,
            title: true,
            referenceNo: true
          }
        },
        messages: {
          where: { deletedAt: null },
          orderBy: [{ receivedAt: "asc" }, { sentAt: "asc" }],
          include: {
            recipients: true,
            attachments: true,
            labels: {
              include: {
                label: true
              }
            }
          }
        }
      }
    });

    if (!thread) {
      throw new NotFoundError("Thread bulunamadı");
    }

    return thread;
  }

  async markMessageRead(actorUserId: string, tenantId: string, messageId: string, read: boolean) {
    const input = markMessageReadSchema.parse({ tenantId, messageId, read });

    const message = await this.prisma.mailMessage.findFirst({
      where: {
        id: input.messageId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      select: {
        id: true,
        threadId: true,
        isRead: true
      }
    });

    if (!message) {
      throw new NotFoundError("Mesaj bulunamadı");
    }

    if (message.isRead !== input.read) {
      await this.prisma.$transaction(async (tx) => {
        await tx.mailMessage.update({
          where: {
            id: message.id
          },
          data: {
            isRead: input.read
          }
        });

        const unreadCount = await tx.mailMessage.count({
          where: {
            tenantId: input.tenantId,
            threadId: message.threadId,
            deletedAt: null,
            isRead: false
          }
        });

        await tx.mailThread.update({
          where: { id: message.threadId },
          data: {
            unreadCount
          }
        });
      });
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      action: "mail.message.read_state_changed",
      resourceType: "mail_message",
      resourceId: messageId,
      metadata: {
        read
      }
    });

    return { success: true };
  }

  async updateMessageFlags(actorUserId: string, payload: unknown) {
    const input = updateMessageFlagsSchema.parse(payload);

    const message = await this.prisma.mailMessage.findFirst({
      where: {
        id: input.messageId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      select: {
        id: true,
        isStarred: true,
        isImportant: true
      }
    });

    if (!message) {
      throw new NotFoundError("Mesaj bulunamadı");
    }

    const updated = await this.prisma.mailMessage.update({
      where: {
        id: message.id
      },
      data: {
        ...(input.isStarred === undefined ? {} : { isStarred: input.isStarred }),
        ...(input.isImportant === undefined ? {} : { isImportant: input.isImportant })
      },
      select: {
        id: true,
        isStarred: true,
        isImportant: true
      }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "mail.message.flags_changed",
      resourceType: "mail_message",
      resourceId: updated.id,
      metadata: {
        previous: {
          isStarred: message.isStarred,
          isImportant: message.isImportant
        },
        next: {
          isStarred: updated.isStarred,
          isImportant: updated.isImportant
        }
      }
    });

    return updated;
  }

  async updateMessageState(actorUserId: string, payload: unknown) {
    const input = updateMessageStateSchema.parse(payload);

    const message = await this.prisma.mailMessage.findFirst({
      where: {
        id: input.messageId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      select: {
        id: true,
        threadId: true,
        state: true
      }
    });

    if (!message) {
      throw new NotFoundError("Mesaj bulunamadı");
    }

    const [updated, unreadCount] = await this.prisma.$transaction(async (tx) => {
      const updatedMany = await tx.mailMessage.updateMany({
        where: {
          tenantId: input.tenantId,
          threadId: message.threadId,
          deletedAt: null
        },
        data: {
          state: input.state
        }
      });

      const nextUnreadCount = await tx.mailMessage.count({
        where: {
          tenantId: input.tenantId,
          threadId: message.threadId,
          deletedAt: null,
          isRead: false
        }
      });

      await tx.mailThread.update({
        where: { id: message.threadId },
        data: { unreadCount: nextUnreadCount }
      });

      return [updatedMany, nextUnreadCount] as const;
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "mail.message.state_changed",
      resourceType: "mail_message",
      resourceId: message.id,
      metadata: {
        previousState: message.state,
        nextState: input.state,
        threadId: message.threadId,
        affectedMessageCount: updated.count
      }
    });

    return {
      id: message.id,
      threadId: message.threadId,
      state: input.state,
      unreadCount,
      affectedMessageCount: updated.count
    };
  }

  async listLabels(tenantId: string, mailboxId?: string) {
    return this.prisma.mailLabel.findMany({
      where: {
        tenantId,
        ...(mailboxId ? { mailboxId } : {})
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: {
        id: true,
        mailboxId: true,
        name: true,
        color: true,
        isSystem: true,
        type: true
      }
    });
  }

  async createLabel(actorUserId: string, payload: unknown) {
    const input = createMailLabelSchema.parse(payload);

    const mailbox = await this.prisma.mailbox.findFirst({
      where: {
        id: input.mailboxId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      select: {
        id: true
      }
    });

    if (!mailbox) {
      throw new NotFoundError("Etiket için mailbox bulunamadı");
    }

    const label = await this.prisma.mailLabel.upsert({
      where: {
        tenantId_mailboxId_name: {
          tenantId: input.tenantId,
          mailboxId: input.mailboxId,
          name: input.name
        }
      },
      create: {
        tenantId: input.tenantId,
        mailboxId: input.mailboxId,
        name: input.name,
        color: input.color ?? null,
        type: "LABEL",
        isSystem: false
      },
      update: {
        color: input.color ?? null,
        type: "LABEL",
        isSystem: false
      },
      select: {
        id: true,
        mailboxId: true,
        name: true,
        color: true,
        isSystem: true,
        type: true
      }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "mail.label.created_or_updated",
      resourceType: "mail_label",
      resourceId: label.id,
      metadata: {
        mailboxId: input.mailboxId,
        name: label.name
      }
    });

    return label;
  }

  async toggleMessageLabel(actorUserId: string, payload: unknown) {
    const input = toggleMessageLabelSchema.parse(payload);

    const [message, label] = await Promise.all([
      this.prisma.mailMessage.findFirst({
        where: {
          id: input.messageId,
          tenantId: input.tenantId,
          deletedAt: null
        },
        select: {
          id: true
        }
      }),
      this.prisma.mailLabel.findFirst({
        where: {
          id: input.labelId,
          tenantId: input.tenantId
        },
        select: {
          id: true,
          name: true
        }
      })
    ]);

    if (!message) {
      throw new NotFoundError("Mesaj bulunamadı");
    }

    if (!label) {
      throw new NotFoundError("Etiket bulunamadı");
    }

    if (input.action === "add") {
      await this.prisma.mailMessageLabel.upsert({
        where: {
          messageId_labelId: {
            messageId: input.messageId,
            labelId: input.labelId
          }
        },
        create: {
          tenantId: input.tenantId,
          messageId: input.messageId,
          labelId: input.labelId
        },
        update: {}
      });
    } else {
      await this.prisma.mailMessageLabel.deleteMany({
        where: {
          messageId: input.messageId,
          labelId: input.labelId
        }
      });
    }

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "mail.message.label_toggled",
      resourceType: "mail_message",
      resourceId: input.messageId,
      metadata: {
        labelId: input.labelId,
        labelName: label.name,
        action: input.action
      }
    });

    return {
      messageId: input.messageId,
      labelId: input.labelId,
      action: input.action
    };
  }

  async createOrAutosaveDraft(actorUserId: string, payload: unknown) {
    const input = createDraftSchema.parse(payload);

    const draft =
      input.draftId !== undefined
        ? await this.updateExistingDraft(actorUserId, {
            ...input,
            draftId: input.draftId
          })
        : await this.prisma.draft.create({
            data: {
              tenantId: input.tenantId,
              mailboxId: input.mailboxId,
              subject: input.subject ?? null,
              bodyText: input.bodyText ?? null,
              toRecipients: input.toRecipients,
              ccRecipients: input.ccRecipients,
              bccRecipients: input.bccRecipients,
              attachmentIds: [],
              lastAutosavedAt: new Date(),
              createdByUserId: actorUserId
            }
          });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "mail.draft.autosaved",
      resourceType: "draft",
      resourceId: draft.id,
      metadata: {
        mailboxId: input.mailboxId,
        hasRecipients: input.toRecipients.length > 0
      }
    });

    return draft;
  }

  async sendMessage(actorUserId: string, payload: unknown) {
    const input = sendMailSchema.parse(payload);

    const mailbox = await this.prisma.mailbox.findFirst({
      where: {
        id: input.mailboxId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      include: {
        connections: {
          where: { status: "CONNECTED" },
          orderBy: { updatedAt: "desc" },
          take: 1
        }
      }
    });

    if (!mailbox) {
      throw new NotFoundError("Gönderim için mailbox bulunamadı");
    }

    const now = new Date();
    const bodyPreview = buildBodyPreview(input.bodyText, input.bodyHtml);
    const resolvedSubject = resolveOutgoingSubject(input.subject, input.bodyText, input.bodyHtml);
    const resolvedAttachments = await this.attachmentSecurityService.resolveOutgoingAttachments(
      actorUserId,
      input
    );

    const providerInput = {
      mailboxId: mailbox.id,
      subject: resolvedSubject,
      to: input.toRecipients,
      cc: input.ccRecipients,
      bcc: input.bccRecipients,
      attachments: resolvedAttachments.map((attachment) => ({
        name: attachment.fileName,
        mimeType: attachment.mimeType,
        contentBase64: attachment.content.toString("base64")
      })),
      ...(input.bodyText === undefined ? {} : { bodyText: input.bodyText }),
      ...(input.bodyHtml === undefined ? {} : { bodyHtml: input.bodyHtml }),
      ...(input.inReplyToMessageId === undefined ? {} : { inReplyToMessageId: input.inReplyToMessageId })
    };

    const providerMessageId = await this.sendViaProvider(
      mailbox.provider,
      mailbox.connections[0],
      providerInput
    );

    const thread = input.threadId
      ? await this.ensureThread(input.tenantId, input.mailboxId, input.threadId)
      : await this.prisma.mailThread.create({
          data: {
            tenantId: input.tenantId,
            mailboxId: input.mailboxId,
            providerThreadId: `out-${randomUUID()}`,
            subject: resolvedSubject,
            normalizedSubject: resolvedSubject.toLowerCase(),
            snippet: bodyPreview,
            messageCount: 0,
            unreadCount: 0,
            lastMessageAt: now
          }
        });

    const message = await this.prisma.$transaction(async (tx) => {
      const createdMessage = await tx.mailMessage.create({
        data: {
          tenantId: input.tenantId,
          mailboxId: input.mailboxId,
          threadId: thread.id,
          providerMessageId,
          internetMessageId: `<${providerMessageId}@${mailbox.email.split("@")[1] ?? "lexoffice.local"}>`,
          direction: "OUTBOUND",
          state: "SENT",
          subject: resolvedSubject,
          snippet: bodyPreview,
          bodyText: input.bodyText ?? null,
          bodyHtml: input.bodyHtml ?? null,
          bodyPreview,
          fromEmail: mailbox.senderIdentityEmail ?? mailbox.email,
          fromName: mailbox.senderIdentityName ?? mailbox.displayName ?? null,
          sentAt: now,
          receivedAt: now,
          isRead: true,
          isStarred: false
        }
      });

      const recipients = buildRecipientRows(input.tenantId, createdMessage.id, input.toRecipients, input.ccRecipients, input.bccRecipients);
      await tx.mailRecipient.createMany({ data: recipients });

      await tx.mailThread.update({
        where: { id: thread.id },
        data: {
          subject: resolvedSubject,
          normalizedSubject: resolvedSubject.toLowerCase(),
          snippet: bodyPreview,
          lastMessageAt: now,
          messageCount: {
            increment: 1
          }
        }
      });

      return createdMessage;
    });

    const persistedAttachments = await this.attachmentSecurityService.persistSentAttachments({
      tenantId: input.tenantId,
      actorUserId,
      messageId: message.id,
      mailboxId: input.mailboxId,
      attachments: resolvedAttachments
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "mail.message.sent",
      resourceType: "mail_message",
      resourceId: message.id,
      metadata: {
        mailboxId: input.mailboxId,
        threadId: thread.id,
        toCount: input.toRecipients.length,
        provider: mailbox.provider,
        attachmentCount: persistedAttachments.attachments.length
      }
    });

    return {
      messageId: message.id,
      threadId: thread.id,
      providerMessageId,
      attachments: persistedAttachments.attachments,
      attachmentScanJobs: persistedAttachments.scanJobs
    };
  }

  async scheduleMessage(actorUserId: string, payload: unknown) {
    const input = scheduleSendMailSchema.parse(payload);
    const scheduledAt = new Date(input.scheduledAt);
    const now = new Date();

    if (Number.isNaN(scheduledAt.getTime())) {
      throw new ConflictError("Geçerli bir zamanlanmış gönderim tarihi girin");
    }

    if (scheduledAt.getTime() <= now.getTime() + 5_000) {
      throw new ConflictError("Zamanlanmış gönderim en az 5 saniye ileriye ayarlanmalıdır");
    }

    if (input.attachments.length > 0 && scheduledAt.getTime() - now.getTime() > 2 * 60 * 60 * 1000) {
      throw new ConflictError("Ekli mailler en fazla 2 saat ileri zamanlanabilir");
    }

    const mailbox = await this.prisma.mailbox.findFirst({
      where: {
        id: input.mailboxId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      select: {
        id: true
      }
    });

    if (!mailbox) {
      throw new NotFoundError("Zamanlama için mailbox bulunamadı");
    }

    const { scheduledAt: _scheduledAt, undoWindowSeconds: _undoWindowSeconds, ...sendPayload } = input;
    const correlationId = randomUUID();

    const stagedAttachmentTokens = input.attachments.flatMap((attachment) =>
      attachment.kind === "staged" ? [attachment.attachmentToken] : []
    );

    const scheduledDraft = await this.prisma.draft.create({
      data: {
        tenantId: input.tenantId,
        mailboxId: input.mailboxId,
        subject: input.subject ?? null,
        bodyText: input.bodyText ?? null,
        bodyHtml: input.bodyHtml ?? null,
        toRecipients: input.toRecipients,
        ccRecipients: input.ccRecipients,
        bccRecipients: input.bccRecipients,
        attachmentIds: stagedAttachmentTokens,
        lastAutosavedAt: now,
        scheduledSendAt: scheduledAt,
        createdByUserId: actorUserId
      }
    });

    const queueJobId = buildScheduledSendJobId(scheduledDraft.id);
    const queuePayload = scheduledMailSendJobSchema.parse({
      tenantId: input.tenantId,
      actorUserId,
      scheduledDraftId: scheduledDraft.id,
      sendPayload,
      correlationId
    });

    await this.prisma.backgroundJob.create({
      data: {
        tenantId: input.tenantId,
        jobType: JOB_NAMES.MAIL_SEND_SCHEDULED,
        queueName: QUEUES.MAIL_DELIVERY,
        status: "QUEUED",
        payload: queuePayload as Prisma.InputJsonValue,
        correlationId,
        externalJobId: queueJobId,
        runAt: scheduledAt
      }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "mail.message.scheduled",
      resourceType: "draft",
      resourceId: scheduledDraft.id,
      metadata: {
        mailboxId: input.mailboxId,
        scheduledAt: scheduledAt.toISOString(),
        toCount: input.toRecipients.length
      }
    });

    return {
      scheduledDraftId: scheduledDraft.id,
      scheduledAt,
      correlationId,
      queueJobId,
      queuePayload
    };
  }

  async cancelScheduledSend(actorUserId: string, payload: unknown) {
    const input = cancelScheduledSendSchema.parse(payload);
    const queueJobId = buildScheduledSendJobId(input.scheduledDraftId);

    const draft = await this.prisma.draft.findFirst({
      where: {
        id: input.scheduledDraftId,
        tenantId: input.tenantId,
        createdByUserId: actorUserId,
        deletedAt: null
      },
      select: {
        id: true,
        scheduledSendAt: true
      }
    });

    if (!draft || !draft.scheduledSendAt) {
      throw new NotFoundError("İptal edilecek zamanlanmış gönderim bulunamadı");
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.draft.update({
        where: {
          id: draft.id
        },
        data: {
          scheduledSendAt: null,
          deletedAt: now
        }
      });

      await tx.backgroundJob.updateMany({
        where: {
          queueName: QUEUES.MAIL_DELIVERY,
          externalJobId: queueJobId,
          status: {
            in: ["QUEUED", "RUNNING"]
          }
        },
        data: {
          status: "FAILED",
          error: "CANCELED_BY_USER",
          finishedAt: now
        }
      });
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "mail.message.scheduled_canceled",
      resourceType: "draft",
      resourceId: draft.id,
      metadata: {
        scheduledAt: draft.scheduledSendAt.toISOString()
      }
    });

    return {
      scheduledDraftId: draft.id,
      canceled: true,
      queueJobId
    };
  }

  async processScheduledSendJob(payload: unknown) {
    const input = scheduledMailSendJobSchema.parse(payload);

    const draft = await this.prisma.draft.findFirst({
      where: {
        id: input.scheduledDraftId,
        tenantId: input.tenantId,
        createdByUserId: input.actorUserId
      },
      select: {
        id: true,
        deletedAt: true,
        scheduledSendAt: true
      }
    });

    if (!draft || draft.deletedAt || !draft.scheduledSendAt) {
      return {
        correlationId: input.correlationId,
        scheduledDraftId: input.scheduledDraftId,
        skipped: true as const,
        reason: "SCHEDULED_DRAFT_MISSING_OR_CANCELED",
        attachmentScanJobs: [] as Array<{
          tenantId: string;
          attachmentId: string;
          correlationId: string;
          triggeredByUserId?: string;
        }>
      };
    }

    if (draft.scheduledSendAt.getTime() > Date.now() + 5_000) {
      return {
        correlationId: input.correlationId,
        scheduledDraftId: draft.id,
        skipped: true as const,
        reason: "SCHEDULED_TIME_NOT_REACHED",
        attachmentScanJobs: [] as Array<{
          tenantId: string;
          attachmentId: string;
          correlationId: string;
          triggeredByUserId?: string;
        }>
      };
    }

    const sent = await this.sendMessage(input.actorUserId, input.sendPayload);

    await this.prisma.draft.update({
      where: {
        id: draft.id
      },
      data: {
        scheduledSendAt: null,
        deletedAt: new Date()
      }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "mail.message.scheduled_sent",
      resourceType: "draft",
      resourceId: draft.id,
      metadata: {
        sentMessageId: sent.messageId,
        threadId: sent.threadId
      }
    });

    return {
      correlationId: input.correlationId,
      scheduledDraftId: draft.id,
      skipped: false as const,
      ...sent
    };
  }

  async linkThreadToMatter(actorUserId: string, payload: LinkThreadToMatterInput) {
    const input = linkThreadToMatterSchema.parse(payload);

    const thread = await this.prisma.mailThread.findFirst({
      where: {
        id: input.threadId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      select: {
        id: true,
        linkedMatterId: true
      }
    });

    if (!thread) {
      throw new NotFoundError("Thread bulunamadı");
    }

    const matter = await this.prisma.matter.findFirst({
      where: {
        id: input.matterId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      select: {
        id: true,
        clientId: true,
        title: true,
        referenceNo: true
      }
    });

    if (!matter) {
      throw new NotFoundError("Matter bulunamadı");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.mailThread.update({
        where: { id: thread.id },
        data: {
          linkedMatterId: matter.id,
          linkedClientId: matter.clientId
        }
      });

      const existingLink = await tx.matterMessage.findFirst({
        where: {
          tenantId: input.tenantId,
          matterId: matter.id,
          threadId: thread.id
        },
        select: { id: true }
      });

      if (!existingLink) {
        await tx.matterMessage.create({
          data: {
            tenantId: input.tenantId,
            matterId: matter.id,
            threadId: thread.id,
            note: input.note ?? null,
            linkedById: actorUserId
          }
        });
      } else if (input.note !== undefined) {
        await tx.matterMessage.update({
          where: { id: existingLink.id },
          data: {
            note: input.note.trim().length > 0 ? input.note : null
          }
        });
      }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "mail.thread.linked_to_matter",
      resourceType: "mail_thread",
      resourceId: thread.id,
      metadata: {
        matterId: matter.id,
        previousMatterId: thread.linkedMatterId
      }
    });

    return {
      threadId: thread.id,
      matterId: matter.id,
      matterTitle: matter.title,
      matterReferenceNo: matter.referenceNo
    };
  }

  private async updateExistingDraft(
    actorUserId: string,
    input: ReturnType<typeof createDraftSchema.parse> & { draftId: string }
  ) {
    const existing = await this.prisma.draft.findFirst({
      where: {
        id: input.draftId,
        tenantId: input.tenantId,
        createdByUserId: actorUserId,
        deletedAt: null
      },
      select: { id: true }
    });

    if (!existing) {
      throw new NotFoundError("Güncellenecek taslak bulunamadı");
    }

    return this.prisma.draft.update({
      where: { id: existing.id },
      data: {
        mailboxId: input.mailboxId,
        subject: input.subject ?? null,
        bodyText: input.bodyText ?? null,
        toRecipients: input.toRecipients,
        ccRecipients: input.ccRecipients,
        bccRecipients: input.bccRecipients,
        lastAutosavedAt: new Date()
      }
    });
  }

  private async ensureThread(tenantId: string, mailboxId: string, threadId: string) {
    const thread = await this.prisma.mailThread.findFirst({
      where: {
        id: threadId,
        tenantId,
        mailboxId,
        deletedAt: null
      }
    });

    if (!thread) {
      throw new NotFoundError("Yanıt için thread bulunamadı");
    }

    return thread;
  }

  private async sendViaProvider(
    provider: "GMAIL" | "MICROSOFT_365" | "YANDEX" | "IMAP_SMTP" | "MANAGED",
    connection: MailboxConnectionTokenSnapshot | undefined,
    input: {
      mailboxId: string;
      subject: string;
      bodyText?: string;
      bodyHtml?: string;
      to: string[];
      cc: string[];
      bcc: string[];
      inReplyToMessageId?: string;
      attachments: Array<{
        name: string;
        contentBase64: string;
        mimeType: string;
      }>;
    }
  ): Promise<string> {
    if (process.env.MAIL_SEND_MOCK === "true" || provider === "MANAGED") {
      return `local-${randomUUID()}`;
    }

    if (!connection) {
      return `local-${randomUUID()}`;
    }

    const accessToken = await this.providerTokenService.resolveAccessToken(connection);
    const adapter = this.providerRegistry.get(provider);
    const result = await adapter.sendMessage(accessToken, input);
    return result.providerMessageId;
  }
}

function buildMessageFilter(
  input: ReturnType<typeof listThreadsSchema.parse>
): Prisma.MailMessageWhereInput {
  const filter: Prisma.MailMessageWhereInput = {
    tenantId: input.tenantId,
    deletedAt: null
  };

  if (input.view === "inbox") {
    filter.state = "RECEIVED";
  } else if (input.view === "unread") {
    filter.isRead = false;
  } else if (input.view === "starred") {
    filter.isStarred = true;
  } else if (input.view === "important") {
    filter.isImportant = true;
  } else if (input.view === "sent") {
    filter.state = "SENT";
  } else if (input.view === "trash") {
    filter.state = "TRASH";
  } else if (input.view === "spam") {
    filter.state = "SPAM";
  } else if (input.view === "archive") {
    filter.state = "ARCHIVED";
  } else if (input.view === "label" && input.labelId) {
    filter.labels = {
      some: {
        labelId: input.labelId
      }
    };
  }

  if (input.readStatus === "read" && input.view !== "unread") {
    filter.isRead = true;
  } else if (input.readStatus === "unread") {
    filter.isRead = false;
  }

  if (input.onlyStarred && input.view !== "starred") {
    filter.isStarred = true;
  }

  const andFilters: Prisma.MailMessageWhereInput[] = [];
  if (input.withAttachments) {
    andFilters.push({
      attachments: {
        some: {}
      }
    });
  }

  if (input.dateFrom || input.dateTo) {
    andFilters.push(buildMessageDateRangeFilter(input.dateFrom, input.dateTo));
  }

  if (andFilters.length > 0) {
    filter.AND = andFilters;
  }

  return filter;
}

function buildMessageQueryFilter(query: string): Prisma.MailMessageWhereInput {
  return {
    OR: [
      { subject: { contains: query, mode: "insensitive" } },
      { snippet: { contains: query, mode: "insensitive" } },
      { bodyText: { contains: query, mode: "insensitive" } },
      { bodyHtml: { contains: query, mode: "insensitive" } },
      { bodyPreview: { contains: query, mode: "insensitive" } },
      { fromEmail: { contains: query, mode: "insensitive" } },
      { fromName: { contains: query, mode: "insensitive" } },
      {
        recipients: {
          some: {
            OR: [
              { email: { contains: query, mode: "insensitive" } },
              { name: { contains: query, mode: "insensitive" } }
            ]
          }
        }
      }
    ]
  };
}

function buildMessageDateRangeFilter(dateFrom?: string, dateTo?: string): Prisma.MailMessageWhereInput {
  const range: Prisma.DateTimeNullableFilter = {};
  if (dateFrom) {
    range.gte = new Date(`${dateFrom}T00:00:00.000Z`);
  }
  if (dateTo) {
    range.lte = new Date(`${dateTo}T23:59:59.999Z`);
  }

  return {
    OR: [{ receivedAt: range }, { sentAt: range }]
  };
}

function resolveOutgoingSubject(subject: string, bodyText?: string, bodyHtml?: string): string {
  if (subject.trim().length > 0) {
    return subject.trim();
  }

  const bodySource = (bodyText ?? stripHtml(bodyHtml) ?? "").trim();
  if (bodySource.length === 0) {
    return "(Konu yok)";
  }

  return bodySource.slice(0, 80);
}

function buildScheduledSendJobId(scheduledDraftId: string): string {
  return `scheduled-send:${scheduledDraftId}`;
}

function buildBodyPreview(bodyText?: string, bodyHtml?: string): string | null {
  const source = (bodyText ?? stripHtml(bodyHtml) ?? "").trim();
  if (source.length === 0) {
    return null;
  }

  return source.slice(0, 160);
}

function stripHtml(html?: string): string | undefined {
  if (!html) {
    return undefined;
  }

  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRecipientRows(
  tenantId: string,
  messageId: string,
  toRecipients: string[],
  ccRecipients: string[],
  bccRecipients: string[]
): Prisma.MailRecipientCreateManyInput[] {
  const rows: Prisma.MailRecipientCreateManyInput[] = [];

  for (const email of toRecipients) {
    rows.push({
      tenantId,
      messageId,
      type: "TO",
      email
    });
  }

  for (const email of ccRecipients) {
    rows.push({
      tenantId,
      messageId,
      type: "CC",
      email
    });
  }

  for (const email of bccRecipients) {
    rows.push({
      tenantId,
      messageId,
      type: "BCC",
      email
    });
  }

  return rows;
}
