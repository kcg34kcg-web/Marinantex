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
      select: { id: true, name: true, locale: true, timezone: true }
    });

    if (!tenant) {
      throw new NotFoundError("Tenant bulunamadı");
    }

    const updated = await this.prisma.tenant.update({
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
          timezone: tenant.timezone
        },
        current: {
          name: updated.name,
          locale: updated.locale,
          timezone: updated.timezone
        }
      }
    });

    return updated;
  }
}
