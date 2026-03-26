import type { PrismaClient } from "@lexoffice/db";
import { connectMailboxSchema, listMailboxesSchema, type ConnectMailboxInput, type ListMailboxesInput } from "@lexoffice/contracts";
import { ConflictError } from "../errors/app-error";
import { AuditService } from "../audit/audit-service";
import { encryptSecret } from "../security/secret-crypto";

export class MailboxService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {}

  async connectMailbox(actorUserId: string, payload: ConnectMailboxInput) {
    const input = connectMailboxSchema.parse(payload);

    const existingConnection = await this.prisma.mailboxConnection.findUnique({
      where: {
        provider_providerAccountId: {
          provider: input.provider,
          providerAccountId: input.providerAccountId
        }
      },
      include: {
        mailbox: true
      }
    });

    if (existingConnection && existingConnection.tenantId !== input.tenantId) {
      throw new ConflictError("Bu provider hesabı başka bir tenant tarafından kullanılıyor");
    }

    const mailbox = await this.prisma.$transaction(async (tx) => {
      const createdMailbox = await tx.mailbox.upsert({
        where: {
          tenantId_email: {
            tenantId: input.tenantId,
            email: input.email.toLowerCase()
          }
        },
        create: {
          tenantId: input.tenantId,
          email: input.email.toLowerCase(),
          displayName: input.displayName ?? null,
          provider: input.provider,
          status: "ACTIVE"
        },
        update: {
          displayName: input.displayName ?? null,
          provider: input.provider,
          status: "ACTIVE",
          deletedAt: null
        }
      });

      await tx.mailboxConnection.upsert({
        where: {
          provider_providerAccountId: {
            provider: input.provider,
            providerAccountId: input.providerAccountId
          }
        },
        create: {
          tenantId: input.tenantId,
          mailboxId: createdMailbox.id,
          userId: actorUserId,
          provider: input.provider,
          providerAccountId: input.providerAccountId,
          accessTokenEncrypted: encryptSecret(input.accessToken),
          refreshTokenEncrypted: input.refreshToken ? encryptSecret(input.refreshToken) : null,
          scopes: input.scopes,
          status: "CONNECTED"
        },
        update: {
          mailboxId: createdMailbox.id,
          userId: actorUserId,
          accessTokenEncrypted: encryptSecret(input.accessToken),
          refreshTokenEncrypted: input.refreshToken ? encryptSecret(input.refreshToken) : null,
          scopes: input.scopes,
          status: "CONNECTED",
          lastError: null
        }
      });

      await tx.mailboxPermission.upsert({
        where: {
          mailboxId_userId: {
            mailboxId: createdMailbox.id,
            userId: actorUserId
          }
        },
        create: {
          tenantId: input.tenantId,
          mailboxId: createdMailbox.id,
          userId: actorUserId,
          canRead: true,
          canSend: true,
          canManage: true
        },
        update: {
          canRead: true,
          canSend: true,
          canManage: true
        }
      });

      await tx.mailboxSyncState.upsert({
        where: {
          mailboxId_provider: {
            mailboxId: createdMailbox.id,
            provider: input.provider
          }
        },
        create: {
          tenantId: input.tenantId,
          mailboxId: createdMailbox.id,
          provider: input.provider,
          syncStatus: "IDLE",
          lastError: null,
          consecutiveErrors: 0
        },
        update: {
          syncStatus: "IDLE",
          lastError: null,
          consecutiveErrors: 0
        }
      });

      return createdMailbox;
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "mailbox.connected",
      resourceType: "mailbox",
      resourceId: mailbox.id,
      metadata: {
        provider: input.provider,
        email: mailbox.email
      }
    });

    return mailbox;
  }

  async listMailboxes(payload: ListMailboxesInput) {
    const input = listMailboxesSchema.parse(payload);

    return this.prisma.mailbox.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        ...(input.provider ? { provider: input.provider } : {})
      },
      orderBy: { createdAt: "desc" },
      include: {
        syncStates: true,
        connections: {
          select: {
            id: true,
            provider: true,
            status: true,
            tokenExpiresAt: true,
            lastError: true,
            updatedAt: true
          }
        }
      }
    });
  }
}
