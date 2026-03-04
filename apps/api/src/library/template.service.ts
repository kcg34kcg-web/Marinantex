import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateTemplateDto } from "./dto/create-template.dto";
import type { ListTemplateQueryDto } from "./dto/list-template-query.dto";
import type { UpdateTemplateDto } from "./dto/update-template.dto";

@Injectable()
export class TemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(tenantId: string, actorUserId: string, input: CreateTemplateDto) {
    const schemaVersion = input.schemaVersion ?? input.canonicalJson.schemaVersion;
    if (schemaVersion !== input.canonicalJson.schemaVersion) {
      throw new BadRequestException(
        "schemaVersion and canonicalJson.schemaVersion mismatch",
      );
    }

    const created = await this.prisma.template.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description ?? null,
        documentType: input.documentType,
        schemaVersion,
        canonicalJson: input.canonicalJson as unknown as Prisma.InputJsonValue,
        createdById: actorUserId,
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        description: true,
        documentType: true,
        schemaVersion: true,
        canonicalJson: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "TEMPLATE_CREATED",
      objectType: "TEMPLATE",
      objectId: created.id,
      metadata: {
        documentType: created.documentType,
        schemaVersion: created.schemaVersion,
      },
      dataClassification: "sensitive_case",
    });

    return created;
  }

  async list(tenantId: string, query: ListTemplateQueryDto) {
    return this.prisma.template.findMany({
      where: {
        tenantId,
        isActive: true,
        documentType: query.documentType,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        tenantId: true,
        name: true,
        description: true,
        documentType: true,
        schemaVersion: true,
        canonicalJson: true,
        isActive: true,
        updatedAt: true,
      },
    });
  }

  async getById(tenantId: string, id: string) {
    const template = await this.prisma.template.findFirst({
      where: { id, tenantId, isActive: true },
      select: {
        id: true,
        tenantId: true,
        name: true,
        description: true,
        documentType: true,
        schemaVersion: true,
        canonicalJson: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!template) {
      throw new NotFoundException("Template not found");
    }
    return template;
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateTemplateDto,
  ) {
    const existing = await this.prisma.template.findFirst({
      where: { id, tenantId, isActive: true },
      select: { id: true, schemaVersion: true },
    });
    if (!existing) {
      throw new NotFoundException("Template not found");
    }

    if (
      input.schemaVersion &&
      input.canonicalJson &&
      input.schemaVersion !== input.canonicalJson.schemaVersion
    ) {
      throw new BadRequestException(
        "schemaVersion and canonicalJson.schemaVersion mismatch",
      );
    }

    const updated = await this.prisma.template.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        schemaVersion: input.schemaVersion ?? input.canonicalJson?.schemaVersion,
        canonicalJson: input.canonicalJson
          ? (input.canonicalJson as unknown as Prisma.InputJsonValue)
          : undefined,
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        description: true,
        documentType: true,
        schemaVersion: true,
        canonicalJson: true,
        isActive: true,
        updatedAt: true,
      },
    });

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "TEMPLATE_UPDATED",
      objectType: "TEMPLATE",
      objectId: id,
      metadata: {
        schemaVersion: updated.schemaVersion,
      },
      dataClassification: "sensitive_case",
    });

    return updated;
  }
}
