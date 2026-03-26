import type { PrismaClient } from "@lexoffice/db";
import {
  createContactSchema,
  deleteContactSchema,
  listContactsSchema,
  updateContactSchema,
  type CreateContactInput,
  type DeleteContactInput,
  type ListContactsInput,
  type UpdateContactInput
} from "@lexoffice/contracts";
import { AuditService } from "../audit/audit-service";
import { ConflictError, NotFoundError } from "../errors/app-error";

export class ContactService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {}

  async listContacts(payload: ListContactsInput) {
    const input = listContactsSchema.parse(payload);

    return this.prisma.contact.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        ...(input.query
          ? {
              OR: [
                { email: { contains: input.query, mode: "insensitive" } },
                { fullName: { contains: input.query, mode: "insensitive" } },
                { firstName: { contains: input.query, mode: "insensitive" } },
                { lastName: { contains: input.query, mode: "insensitive" } },
                { company: { contains: input.query, mode: "insensitive" } }
              ]
            }
          : {})
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: input.limit
    });
  }

  async createContact(actorUserId: string, payload: CreateContactInput) {
    const input = createContactSchema.parse(payload);
    const normalizedEmail = normalizeEmail(input.email);
    const firstName = normalizeNullableString(input.firstName);
    const lastName = normalizeNullableString(input.lastName);
    const explicitFullName = normalizeNullableString(input.fullName);
    const fullName = explicitFullName ?? joinNameParts(firstName, lastName);

    try {
      const contact = await this.prisma.contact.create({
        data: {
          tenantId: input.tenantId,
          email: normalizedEmail,
          firstName,
          lastName,
          fullName,
          phone: normalizeNullableString(input.phone),
          title: normalizeNullableString(input.title),
          company: normalizeNullableString(input.company),
          notes: normalizeNullableString(input.notes)
        }
      });

      await this.auditService.log({
        tenantId: input.tenantId,
        actorUserId,
        action: "contact.created",
        resourceType: "contact",
        resourceId: contact.id,
        metadata: {
          email: contact.email,
          fullName: contact.fullName
        }
      });

      return contact;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictError("Bu email ile kayıtlı bir kişi zaten var");
      }
      throw error;
    }
  }

  async updateContact(actorUserId: string, payload: UpdateContactInput) {
    const input = updateContactSchema.parse(payload);

    const existing = await this.prisma.contact.findFirst({
      where: {
        id: input.contactId,
        tenantId: input.tenantId,
        deletedAt: null
      }
    });

    if (!existing) {
      throw new NotFoundError("Güncellenecek kişi bulunamadı");
    }

    const hasFirstName = input.firstName !== undefined;
    const hasLastName = input.lastName !== undefined;
    const hasFullName = input.fullName !== undefined;

    const nextFirstName = hasFirstName ? normalizeNullableString(input.firstName) : existing.firstName;
    const nextLastName = hasLastName ? normalizeNullableString(input.lastName) : existing.lastName;
    const nextFullName = hasFullName
      ? normalizeNullableString(input.fullName)
      : hasFirstName || hasLastName
        ? joinNameParts(nextFirstName, nextLastName)
        : existing.fullName;

    try {
      const contact = await this.prisma.contact.update({
        where: { id: existing.id },
        data: {
          ...(hasFirstName ? { firstName: nextFirstName } : {}),
          ...(hasLastName ? { lastName: nextLastName } : {}),
          ...(hasFullName || hasFirstName || hasLastName ? { fullName: nextFullName } : {}),
          ...(input.email !== undefined ? { email: normalizeEmail(input.email) } : {}),
          ...(input.phone !== undefined ? { phone: normalizeNullableString(input.phone) } : {}),
          ...(input.title !== undefined ? { title: normalizeNullableString(input.title) } : {}),
          ...(input.company !== undefined ? { company: normalizeNullableString(input.company) } : {}),
          ...(input.notes !== undefined ? { notes: normalizeNullableString(input.notes) } : {})
        }
      });

      await this.auditService.log({
        tenantId: input.tenantId,
        actorUserId,
        action: "contact.updated",
        resourceType: "contact",
        resourceId: contact.id,
        metadata: {
          email: contact.email,
          fullName: contact.fullName
        }
      });

      return contact;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictError("Bu email ile kayıtlı bir kişi zaten var");
      }
      throw error;
    }
  }

  async deleteContact(actorUserId: string, payload: DeleteContactInput) {
    const input = deleteContactSchema.parse(payload);

    const existing = await this.prisma.contact.findFirst({
      where: {
        id: input.contactId,
        tenantId: input.tenantId,
        deletedAt: null
      }
    });

    if (!existing) {
      throw new NotFoundError("Silinecek kişi bulunamadı");
    }

    const deleted = await this.prisma.contact.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "contact.deleted",
      resourceType: "contact",
      resourceId: deleted.id,
      metadata: {
        email: deleted.email,
        fullName: deleted.fullName
      }
    });

    return deleted;
  }
}

function normalizeNullableString(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function joinNameParts(firstName: string | null, lastName: string | null): string | null {
  const full = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  return full.length > 0 ? full : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return maybeCode === "P2002";
}
