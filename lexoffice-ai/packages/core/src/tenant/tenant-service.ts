import type { PrismaClient } from "@lexoffice/db";
import {
  createTenantSchema,
  inviteMemberSchema,
  updateTenantProfileSchema,
  type CreateTenantInput,
  type InviteMemberInput,
  type UpdateTenantProfileInput
} from "@lexoffice/contracts";
import { ConflictError, NotFoundError } from "../errors/app-error";
import { AuditService } from "../audit/audit-service";

export class TenantService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {}

  async createTenant(ownerUserId: string, payload: CreateTenantInput) {
    const input = createTenantSchema.parse(payload);

    const existing = await this.prisma.tenant.findUnique({
      where: { slug: input.slug }
    });

    if (existing && !existing.deletedAt) {
      throw new ConflictError("Bu slug zaten kullanımda");
    }

    const ownerRole = await this.prisma.role.findFirst({
      where: {
        code: "tenant_owner",
        tenantId: null,
        deletedAt: null
      }
    });

    if (!ownerRole) {
      throw new NotFoundError("tenant_owner rolü bulunamadı. Seed çalıştırılmalı");
    }

    const tenant = await this.prisma.$transaction(async (tx) => {
      const createdTenant = await tx.tenant.create({
        data: {
          name: input.name,
          slug: input.slug,
          ownerUserId,
          locale: input.locale,
          timezone: input.timezone
        }
      });

      await tx.tenantSettings.create({
        data: {
          tenantId: createdTenant.id
        }
      });

      await tx.membership.create({
        data: {
          tenantId: createdTenant.id,
          userId: ownerUserId,
          roleId: ownerRole.id,
          status: "ACTIVE",
          joinedAt: new Date()
        }
      });

      return createdTenant;
    });

    await this.auditService.log({
      tenantId: tenant.id,
      actorUserId: ownerUserId,
      action: "tenant.created",
      resourceType: "tenant",
      resourceId: tenant.id,
      metadata: {
        slug: tenant.slug
      }
    });

    return tenant;
  }

  async inviteMember(actorUserId: string, payload: InviteMemberInput) {
    const input = inviteMemberSchema.parse(payload);

    const role = await this.prisma.role.findFirst({
      where: {
        code: input.roleCode,
        deletedAt: null,
        OR: [{ tenantId: null }, { tenantId: input.tenantId }]
      }
    });

    if (!role) {
      throw new NotFoundError("Rol bulunamadı");
    }

    const normalizedEmail = input.email.trim().toLowerCase();

    const user = await this.prisma.user.upsert({
      where: { normalizedEmail },
      create: {
        email: input.email,
        normalizedEmail,
        firstName: input.firstName,
        lastName: input.lastName,
        active: true
      },
      update: {
        firstName: input.firstName,
        lastName: input.lastName
      }
    });

    const membership = await this.prisma.membership.upsert({
      where: {
        tenantId_userId: {
          tenantId: input.tenantId,
          userId: user.id
        }
      },
      create: {
        tenantId: input.tenantId,
        userId: user.id,
        roleId: role.id,
        status: "INVITED",
        invitedById: actorUserId,
        invitedAt: new Date()
      },
      update: {
        roleId: role.id,
        status: "INVITED",
        invitedById: actorUserId,
        invitedAt: new Date(),
        deletedAt: null
      }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "member.invited",
      resourceType: "membership",
      resourceId: membership.id,
      metadata: {
        email: input.email,
        roleCode: input.roleCode
      }
    });

    return membership;
  }

  async getTenantBySlug(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: {
        settings: true,
        subscriptionPlan: true
      }
    });

    if (!tenant || tenant.deletedAt) {
      throw new NotFoundError("Tenant bulunamadı");
    }

    return tenant;
  }

  async updateTenantProfile(actorUserId: string, payload: UpdateTenantProfileInput) {
    const input = updateTenantProfileSchema.parse(payload);

    const tenant = await this.prisma.tenant.findFirst({
      where: {
        id: input.tenantId,
        deletedAt: null
      },
      select: {
        id: true,
        name: true,
        locale: true,
        timezone: true,
        settings: {
          select: {
            mailConversationViewEnabled: true,
            composeDefaultFont: true,
            defaultSenderMailboxId: true,
            mailForwardingEnabled: true,
            mailForwardingRecipients: true,
            mailForwardingMailboxId: true,
            autoResponderEnabled: true,
            autoResponderSubject: true,
            autoResponderBodyText: true
          }
        }
      }
    });

    if (!tenant) {
      throw new NotFoundError("Tenant bulunamadı");
    }

    if (input.defaultSenderMailboxId !== undefined && input.defaultSenderMailboxId !== null) {
      const mailbox = await this.prisma.mailbox.findFirst({
        where: {
          id: input.defaultSenderMailboxId,
          tenantId: tenant.id,
          deletedAt: null
        },
        select: {
          id: true
        }
      });

      if (!mailbox) {
        throw new ConflictError("Varsayılan gönderici hesabı bulunamadı");
      }
    }

    if (input.mailForwardingMailboxId !== undefined && input.mailForwardingMailboxId !== null) {
      const mailbox = await this.prisma.mailbox.findFirst({
        where: {
          id: input.mailForwardingMailboxId,
          tenantId: tenant.id,
          deletedAt: null
        },
        select: {
          id: true
        }
      });

      if (!mailbox) {
        throw new ConflictError("Mail yönlendirme mailbox seçimi geçersiz");
      }
    }

    const nextForwardingEnabled =
      input.mailForwardingEnabled ?? tenant.settings?.mailForwardingEnabled ?? false;
    const nextForwardingRecipients =
      input.mailForwardingRecipients ?? tenant.settings?.mailForwardingRecipients ?? [];

    if (nextForwardingEnabled && nextForwardingRecipients.length === 0) {
      throw new ConflictError("Mail yönlendirme açıkken en az bir hedef e-posta zorunludur");
    }

    const nextAutoResponderEnabled =
      input.autoResponderEnabled ?? tenant.settings?.autoResponderEnabled ?? false;
    const nextAutoResponderSubject =
      input.autoResponderSubject !== undefined
        ? normalizeNullableText(input.autoResponderSubject)
        : tenant.settings?.autoResponderSubject ?? null;
    const nextAutoResponderBodyText =
      input.autoResponderBodyText !== undefined
        ? normalizeNullableText(input.autoResponderBodyText)
        : tenant.settings?.autoResponderBodyText ?? null;

    if (
      nextAutoResponderEnabled &&
      (!nextAutoResponderSubject || !nextAutoResponderBodyText)
    ) {
      throw new ConflictError("Otomatik yanıtlayıcı için konu ve mesaj metni zorunludur");
    }

    const [updatedTenant, updatedSettings] = await this.prisma.$transaction(async (tx) => {
      const nextTenant = await tx.tenant.update({
        where: { id: tenant.id },
        data: {
          name: input.name,
          locale: input.locale ?? tenant.locale,
          timezone: input.timezone ?? tenant.timezone
        },
        select: {
          id: true,
          name: true,
          locale: true,
          timezone: true
        }
      });

      const nextSettings = await tx.tenantSettings.upsert({
        where: {
          tenantId: tenant.id
        },
        create: {
          tenantId: tenant.id,
          mailConversationViewEnabled: input.mailConversationViewEnabled ?? true,
          composeDefaultFont: input.composeDefaultFont ?? "system",
          defaultSenderMailboxId: input.defaultSenderMailboxId ?? null,
          mailForwardingEnabled: input.mailForwardingEnabled ?? false,
          mailForwardingRecipients: (input.mailForwardingRecipients ?? []).map((item) =>
            item.trim().toLowerCase()
          ),
          mailForwardingMailboxId: input.mailForwardingMailboxId ?? null,
          autoResponderEnabled: input.autoResponderEnabled ?? false,
          autoResponderSubject:
            input.autoResponderSubject !== undefined
              ? normalizeNullableText(input.autoResponderSubject)
              : null,
          autoResponderBodyText:
            input.autoResponderBodyText !== undefined
              ? normalizeNullableText(input.autoResponderBodyText)
              : null
        },
        update: {
          ...(input.mailConversationViewEnabled !== undefined
            ? { mailConversationViewEnabled: input.mailConversationViewEnabled }
            : {}),
          ...(input.composeDefaultFont !== undefined
            ? { composeDefaultFont: input.composeDefaultFont }
            : {}),
          ...(input.defaultSenderMailboxId !== undefined
            ? { defaultSenderMailboxId: input.defaultSenderMailboxId }
            : {}),
          ...(input.mailForwardingEnabled !== undefined
            ? { mailForwardingEnabled: input.mailForwardingEnabled }
            : {}),
          ...(input.mailForwardingRecipients !== undefined
            ? {
                mailForwardingRecipients: input.mailForwardingRecipients.map((item) =>
                  item.trim().toLowerCase()
                )
              }
            : {}),
          ...(input.mailForwardingMailboxId !== undefined
            ? { mailForwardingMailboxId: input.mailForwardingMailboxId }
            : {}),
          ...(input.autoResponderEnabled !== undefined
            ? { autoResponderEnabled: input.autoResponderEnabled }
            : {}),
          ...(input.autoResponderSubject !== undefined
            ? { autoResponderSubject: normalizeNullableText(input.autoResponderSubject) }
            : {}),
          ...(input.autoResponderBodyText !== undefined
            ? { autoResponderBodyText: normalizeNullableText(input.autoResponderBodyText) }
            : {})
        },
        select: {
          mailConversationViewEnabled: true,
          composeDefaultFont: true,
          defaultSenderMailboxId: true,
          mailForwardingEnabled: true,
          mailForwardingRecipients: true,
          mailForwardingMailboxId: true,
          autoResponderEnabled: true,
          autoResponderSubject: true,
          autoResponderBodyText: true
        }
      });

      return [nextTenant, nextSettings] as const;
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "tenant.profile.updated",
      resourceType: "tenant",
      resourceId: tenant.id,
      metadata: {
        previous: {
          name: tenant.name,
          locale: tenant.locale,
          timezone: tenant.timezone,
          mailConversationViewEnabled: tenant.settings?.mailConversationViewEnabled ?? true,
          composeDefaultFont: tenant.settings?.composeDefaultFont ?? "system",
          defaultSenderMailboxId: tenant.settings?.defaultSenderMailboxId ?? null,
          mailForwardingEnabled: tenant.settings?.mailForwardingEnabled ?? false,
          mailForwardingRecipients: tenant.settings?.mailForwardingRecipients ?? [],
          mailForwardingMailboxId: tenant.settings?.mailForwardingMailboxId ?? null,
          autoResponderEnabled: tenant.settings?.autoResponderEnabled ?? false,
          autoResponderSubject: tenant.settings?.autoResponderSubject ?? null,
          autoResponderBodyText: tenant.settings?.autoResponderBodyText ?? null
        },
        current: {
          name: updatedTenant.name,
          locale: updatedTenant.locale,
          timezone: updatedTenant.timezone,
          mailConversationViewEnabled: updatedSettings.mailConversationViewEnabled,
          composeDefaultFont: updatedSettings.composeDefaultFont,
          defaultSenderMailboxId: updatedSettings.defaultSenderMailboxId,
          mailForwardingEnabled: updatedSettings.mailForwardingEnabled,
          mailForwardingRecipients: updatedSettings.mailForwardingRecipients,
          mailForwardingMailboxId: updatedSettings.mailForwardingMailboxId,
          autoResponderEnabled: updatedSettings.autoResponderEnabled,
          autoResponderSubject: updatedSettings.autoResponderSubject,
          autoResponderBodyText: updatedSettings.autoResponderBodyText
        }
      }
    });

    return {
      ...updatedTenant,
      mailConversationViewEnabled: updatedSettings.mailConversationViewEnabled,
      composeDefaultFont: updatedSettings.composeDefaultFont,
      defaultSenderMailboxId: updatedSettings.defaultSenderMailboxId,
      mailForwardingEnabled: updatedSettings.mailForwardingEnabled,
      mailForwardingRecipients: updatedSettings.mailForwardingRecipients,
      mailForwardingMailboxId: updatedSettings.mailForwardingMailboxId,
      autoResponderEnabled: updatedSettings.autoResponderEnabled,
      autoResponderSubject: updatedSettings.autoResponderSubject,
      autoResponderBodyText: updatedSettings.autoResponderBodyText
    };
  }
}

function normalizeNullableText(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
