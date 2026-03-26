import type { PrismaClient } from "@lexoffice/db";
import {
  provisionManagedMailboxSchema,
  type ProvisionManagedMailboxInput
} from "@lexoffice/contracts";
import {
  MailboxProvisioningRegistry,
  type ProvisioningProvider
} from "@lexoffice/mail";
import { AuditService } from "../audit/audit-service";
import { ConflictError, NotFoundError } from "../errors/app-error";

export class MailboxProvisioningService {
  private readonly provisioningRegistry: MailboxProvisioningRegistry;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {
    this.provisioningRegistry = new MailboxProvisioningRegistry();
  }

  async provisionMailbox(actorUserId: string, payload: ProvisionManagedMailboxInput) {
    const input = provisionManagedMailboxSchema.parse(payload);
    const domain = await this.prisma.domain.findFirst({
      where: {
        id: input.domainId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      select: {
        id: true,
        tenantId: true,
        domainName: true,
        status: true,
        provider: true,
        onboardingMode: true
      }
    });

    if (!domain) {
      throw new NotFoundError("Provisioning için domain bulunamadı");
    }

    if (!["VERIFIED", "MAIL_READY"].includes(domain.status)) {
      throw new ConflictError("Domain henüz mailbox provisioning için hazır değil");
    }

    const localPart = input.localPart.trim().toLowerCase();
    const email = `${localPart}@${domain.domainName}`;
    const existingMailbox = await this.prisma.mailbox.findFirst({
      where: {
        tenantId: input.tenantId,
        email,
        deletedAt: null
      },
      select: { id: true }
    });

    if (existingMailbox) {
      throw new ConflictError("Bu email adresi zaten mevcut");
    }

    const targetProvider = resolveProvisioningProvider(domain.provider, input.provider);
    const adapter = this.provisioningRegistry.get(targetProvider);
    const provisionResult = await adapter.createMailbox({
      tenantId: input.tenantId,
      domain: domain.domainName,
      email,
      ...(input.displayName ? { displayName: input.displayName } : {})
    });

    const aliasLocalParts = [...new Set(input.aliasLocalParts.map((alias) => alias.toLowerCase()))]
      .filter((alias) => alias !== localPart)
      .slice(0, 20);

    const mailbox = await this.prisma.$transaction(async (tx) => {
      const createdMailbox = await tx.mailbox.create({
        data: {
          tenantId: input.tenantId,
          domainId: domain.id,
          provider: targetProvider,
          email,
          displayName: input.displayName ?? null,
          status: provisionResult.status === "ACTIVE" ? "ACTIVE" : "PENDING",
          senderIdentityEmail: email,
          senderIdentityName: input.displayName ?? null
        }
      });

      if (aliasLocalParts.length > 0) {
        for (const aliasLocalPart of aliasLocalParts) {
          const aliasEmail = `${aliasLocalPart}@${domain.domainName}`;
          await adapter.createAlias({
            tenantId: input.tenantId,
            mailboxEmail: email,
            aliasEmail
          });

          await tx.mailboxAlias.create({
            data: {
              tenantId: input.tenantId,
              mailboxId: createdMailbox.id,
              aliasEmail,
              displayName: input.displayName ?? null,
              isPrimary: false
            }
          });
        }
      }

      await tx.mailboxSyncState.create({
        data: {
          tenantId: input.tenantId,
          mailboxId: createdMailbox.id,
          provider: targetProvider,
          syncStatus: "IDLE"
        }
      });

      await tx.mailboxPermission.create({
        data: {
          tenantId: input.tenantId,
          mailboxId: createdMailbox.id,
          userId: actorUserId,
          canRead: true,
          canSend: true,
          canManage: true
        }
      });

      return createdMailbox;
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "mailbox.provisioned",
      resourceType: "mailbox",
      resourceId: mailbox.id,
      metadata: {
        domainId: domain.id,
        provider: targetProvider,
        mailboxEmail: email,
        aliasCount: aliasLocalParts.length,
        adapterMode: adapter.mode,
        externalMailboxId: provisionResult.externalMailboxId
      }
    });

    return {
      mailbox,
      provisioning: {
        provider: targetProvider,
        mode: adapter.mode,
        externalMailboxId: provisionResult.externalMailboxId,
        ...(provisionResult.notes ? { notes: provisionResult.notes } : {})
      }
    };
  }
}

function resolveProvisioningProvider(
  domainProvider: "GMAIL" | "MICROSOFT_365" | "YANDEX" | "IMAP_SMTP" | "MANAGED" | null,
  payloadProvider: "GMAIL" | "MICROSOFT_365" | "YANDEX" | "IMAP_SMTP" | "MANAGED"
): ProvisioningProvider {
  if (payloadProvider !== "MANAGED") {
    return payloadProvider;
  }

  return domainProvider ?? "MANAGED";
}
