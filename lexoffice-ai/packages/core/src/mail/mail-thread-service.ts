import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@lexoffice/db";
import { MailProviderRegistry } from "@lexoffice/mail";
import {
  createDraftSchema,
  linkThreadToMatterSchema,
  sendMailSchema,
  getThreadSchema,
  listThreadsSchema,
  markMessageReadSchema,
  type LinkThreadToMatterInput,
  type ListThreadsInput
} from "@lexoffice/contracts";
import { NotFoundError } from "../errors/app-error";
import { AuditService } from "../audit/audit-service";

export class MailThreadService {
  private readonly providerRegistry: MailProviderRegistry;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {
    this.providerRegistry = new MailProviderRegistry();
  }

  async listThreads(payload: ListThreadsInput) {
    const input = listThreadsSchema.parse(payload);

    const threads = await this.prisma.mailThread.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
        ...(input.query
          ? {
              OR: [
                { subject: { contains: input.query, mode: "insensitive" } },
                { snippet: { contains: input.query, mode: "insensitive" } }
              ]
            }
          : {}),
        ...(input.cursor
          ? {
              lastMessageAt: {
                lt: new Date(input.cursor)
              }
            }
          : {})
      },
      take: input.limit,
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
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
          take: 1,
          orderBy: [{ receivedAt: "desc" }, { sentAt: "desc" }],
          select: {
            id: true,
            fromEmail: true,
            fromName: true,
            snippet: true,
            isRead: true,
            isSensitive: true,
            receivedAt: true,
            sentAt: true
          }
        }
      }
    });

    const lastThread = threads.at(-1);
    const nextCursor =
      threads.length === input.limit && lastThread?.lastMessageAt ? lastThread.lastMessageAt.toISOString() : null;

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

    const providerInput = {
      mailboxId: mailbox.id,
      subject: resolvedSubject,
      to: input.toRecipients,
      cc: input.ccRecipients,
      bcc: input.bccRecipients,
      attachments: input.attachments,
      ...(input.bodyText === undefined ? {} : { bodyText: input.bodyText }),
      ...(input.bodyHtml === undefined ? {} : { bodyHtml: input.bodyHtml }),
      ...(input.inReplyToMessageId === undefined ? {} : { inReplyToMessageId: input.inReplyToMessageId })
    };

    const providerMessageId = await this.sendViaProvider(
      mailbox.provider,
      mailbox.connections[0]?.accessTokenEncrypted,
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
        provider: mailbox.provider
      }
    });

    return {
      messageId: message.id,
      threadId: thread.id,
      providerMessageId
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
    accessToken: string | undefined,
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
    if (process.env.MAIL_SEND_MOCK === "true" || provider === "MANAGED" || !accessToken) {
      return `local-${randomUUID()}`;
    }

    try {
      const adapter = this.providerRegistry.get(provider);
      const result = await adapter.sendMessage(accessToken, input);
      return result.providerMessageId;
    } catch {
      return `local-${randomUUID()}`;
    }
  }
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
