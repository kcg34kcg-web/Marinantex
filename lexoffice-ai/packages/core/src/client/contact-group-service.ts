import type { PrismaClient } from "@lexoffice/db";
import {
  createContactGroupSchema,
  deleteContactGroupSchema,
  listContactGroupsSchema,
  updateContactGroupSchema,
  type CreateContactGroupInput,
  type DeleteContactGroupInput,
  type ListContactGroupsInput,
  type UpdateContactGroupInput
} from "@lexoffice/contracts";
import { AuditService } from "../audit/audit-service";
import { ConflictError, NotFoundError } from "../errors/app-error";

export class ContactGroupService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {}

  async listContactGroups(payload: ListContactGroupsInput) {
    const input = listContactGroupsSchema.parse(payload);

    return this.prisma.contactGroup.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        ...(input.query
          ? {
              OR: [
                { name: { contains: input.query, mode: "insensitive" } },
                { description: { contains: input.query, mode: "insensitive" } },
                {
                  members: {
                    some: {
                      contact: {
                        OR: [
                          { email: { contains: input.query, mode: "insensitive" } },
                          { fullName: { contains: input.query, mode: "insensitive" } },
                          { firstName: { contains: input.query, mode: "insensitive" } },
                          { lastName: { contains: input.query, mode: "insensitive" } }
                        ]
                      }
                    }
                  }
                }
              ]
            }
          : {})
      },
      include: {
        members: {
          orderBy: [{ createdAt: "asc" }],
          include: {
            contact: {
              select: {
                id: true,
                email: true,
                fullName: true,
                firstName: true,
                lastName: true
              }
            }
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: input.limit
    });
  }

  async createContactGroup(actorUserId: string, payload: CreateContactGroupInput) {
    const input = createContactGroupSchema.parse(payload);
    const name = normalizeGroupName(input.name);
    const contactIds = uniqueIds(input.contactIds);
    await this.assertContactsExist(input.tenantId, contactIds);

    try {
      const createData = {
        tenantId: input.tenantId,
        name,
        description: normalizeNullableString(input.description),
        color: normalizeHexColor(input.color),
        createdById: actorUserId,
        ...(contactIds.length > 0
          ? {
              members: {
                createMany: {
                  data: contactIds.map((contactId) => ({
                    tenantId: input.tenantId,
                    contactId
                  }))
                }
              }
            }
          : {})
      };

      const group = await this.prisma.contactGroup.create({
        data: createData,
        include: {
          members: {
            orderBy: [{ createdAt: "asc" }],
            include: {
              contact: {
                select: {
                  id: true,
                  email: true,
                  fullName: true,
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        }
      });

      await this.auditService.log({
        tenantId: input.tenantId,
        actorUserId,
        action: "contact_group.created",
        resourceType: "contact_group",
        resourceId: group.id,
        metadata: {
          name: group.name,
          memberCount: group.members.length
        }
      });

      return group;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictError("Bu isimle kayıtlı bir kişi grubu zaten var");
      }
      throw error;
    }
  }

  async updateContactGroup(actorUserId: string, payload: UpdateContactGroupInput) {
    const input = updateContactGroupSchema.parse(payload);

    const existing = await this.prisma.contactGroup.findFirst({
      where: {
        id: input.groupId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      select: {
        id: true,
        name: true
      }
    });

    if (!existing) {
      throw new NotFoundError("Güncellenecek kişi grubu bulunamadı");
    }

    const contactIds = input.contactIds ? uniqueIds(input.contactIds) : null;
    if (contactIds) {
      await this.assertContactsExist(input.tenantId, contactIds);
    }

    try {
      const group = await this.prisma.$transaction(async (tx) => {
        await tx.contactGroup.update({
          where: { id: existing.id },
          data: {
            ...(input.name !== undefined ? { name: normalizeGroupName(input.name) } : {}),
            ...(input.description !== undefined
              ? { description: normalizeNullableString(input.description) }
              : {}),
            ...(input.color !== undefined ? { color: normalizeHexColor(input.color) } : {})
          }
        });

        if (contactIds) {
          await tx.contactGroupMember.deleteMany({
            where: {
              groupId: existing.id
            }
          });

          if (contactIds.length > 0) {
            await tx.contactGroupMember.createMany({
              data: contactIds.map((contactId) => ({
                tenantId: input.tenantId,
                groupId: existing.id,
                contactId
              }))
            });
          }
        }

        return tx.contactGroup.findUniqueOrThrow({
          where: { id: existing.id },
          include: {
            members: {
              orderBy: [{ createdAt: "asc" }],
              include: {
                contact: {
                  select: {
                    id: true,
                    email: true,
                    fullName: true,
                    firstName: true,
                    lastName: true
                  }
                }
              }
            }
          }
        });
      });

      await this.auditService.log({
        tenantId: input.tenantId,
        actorUserId,
        action: "contact_group.updated",
        resourceType: "contact_group",
        resourceId: group.id,
        metadata: {
          previousName: existing.name,
          currentName: group.name,
          memberCount: group.members.length
        }
      });

      return group;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictError("Bu isimle kayıtlı bir kişi grubu zaten var");
      }
      throw error;
    }
  }

  async deleteContactGroup(actorUserId: string, payload: DeleteContactGroupInput) {
    const input = deleteContactGroupSchema.parse(payload);

    const existing = await this.prisma.contactGroup.findFirst({
      where: {
        id: input.groupId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      include: {
        _count: {
          select: {
            members: true
          }
        }
      }
    });

    if (!existing) {
      throw new NotFoundError("Silinecek kişi grubu bulunamadı");
    }

    const deleted = await this.prisma.$transaction(async (tx) => {
      const group = await tx.contactGroup.update({
        where: { id: existing.id },
        data: {
          deletedAt: new Date()
        }
      });

      await tx.contactGroupMember.deleteMany({
        where: {
          groupId: existing.id
        }
      });

      return group;
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "contact_group.deleted",
      resourceType: "contact_group",
      resourceId: deleted.id,
      metadata: {
        name: deleted.name,
        memberCount: existing._count.members
      }
    });

    return deleted;
  }

  private async assertContactsExist(tenantId: string, contactIds: string[]) {
    if (contactIds.length === 0) {
      return;
    }

    const existing = await this.prisma.contact.findMany({
      where: {
        tenantId,
        deletedAt: null,
        id: { in: contactIds }
      },
      select: {
        id: true
      }
    });

    if (existing.length !== contactIds.length) {
      throw new NotFoundError("Gruplandırılacak kişilerden bazıları bulunamadı");
    }
  }
}

function normalizeNullableString(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeGroupName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    throw new ConflictError("Grup adı en az 2 karakter olmalı");
  }
  return trimmed;
}

function normalizeHexColor(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : null;
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values)];
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return maybeCode === "P2002";
}
