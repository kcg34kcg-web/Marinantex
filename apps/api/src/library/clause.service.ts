import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateClauseDto } from "./dto/create-clause.dto";
import type { ListClauseQueryDto } from "./dto/list-clause-query.dto";
import type { UpdateClauseDto } from "./dto/update-clause.dto";

@Injectable()
export class ClauseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(tenantId: string, actorUserId: string, input: CreateClauseDto) {
    const created = await this.prisma.clause.create({
      data: {
        tenantId,
        title: input.title,
        category: input.category ?? "GENERAL",
        bodyJson: input.bodyJson as unknown as Prisma.InputJsonValue,
        createdById: actorUserId,
      },
      select: {
        id: true,
        tenantId: true,
        title: true,
        category: true,
        bodyJson: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "CLAUSE_CREATED",
      objectType: "CLAUSE",
      objectId: created.id,
      metadata: {
        category: created.category,
      },
      dataClassification: "sensitive_case",
    });

    return created;
  }

  async list(tenantId: string, query: ListClauseQueryDto) {
    return this.prisma.clause.findMany({
      where: {
        tenantId,
        isActive: true,
        category: query.category,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        tenantId: true,
        title: true,
        category: true,
        bodyJson: true,
        isActive: true,
        updatedAt: true,
      },
    });
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: UpdateClauseDto,
  ) {
    const existing = await this.prisma.clause.findFirst({
      where: { id, tenantId, isActive: true },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException("Clause not found");
    }

    const updated = await this.prisma.clause.update({
      where: { id },
      data: {
        title: input.title,
        category: input.category,
        bodyJson: input.bodyJson
          ? (input.bodyJson as unknown as Prisma.InputJsonValue)
          : undefined,
      },
      select: {
        id: true,
        tenantId: true,
        title: true,
        category: true,
        bodyJson: true,
        isActive: true,
        updatedAt: true,
      },
    });

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "CLAUSE_UPDATED",
      objectType: "CLAUSE",
      objectId: id,
      metadata: {
        category: updated.category,
      },
      dataClassification: "sensitive_case",
    });

    return updated;
  }
}
