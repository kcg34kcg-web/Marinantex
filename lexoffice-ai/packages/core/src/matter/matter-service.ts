import type { PrismaClient } from "@lexoffice/db";
import {
  createMatterSchema,
  listMattersSchema,
  type CreateMatterInput,
  type ListMattersInput
} from "@lexoffice/contracts";
import { AuditService } from "../audit/audit-service";
import { NotFoundError } from "../errors/app-error";

export class MatterService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {}

  async listMatters(payload: ListMattersInput) {
    const input = listMattersSchema.parse(payload);

    return this.prisma.matter.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...(input.status ? { status: input.status } : {})
      },
      include: {
        client: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: [{ openedAt: "desc" }, { createdAt: "desc" }],
      take: input.limit
    });
  }

  async createMatter(actorUserId: string, payload: CreateMatterInput) {
    const input = createMatterSchema.parse(payload);

    const client = await this.prisma.client.findFirst({
      where: {
        id: input.clientId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      select: { id: true }
    });

    if (!client) {
      throw new NotFoundError("Matter oluşturmak için client bulunamadı");
    }

    const matter = await this.prisma.matter.create({
      data: {
        tenantId: input.tenantId,
        clientId: input.clientId,
        title: input.title,
        referenceNo: input.referenceNo ?? null,
        practiceArea: input.practiceArea ?? null,
        description: input.description ?? null,
        status: input.status
      },
      include: {
        client: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "matter.created",
      resourceType: "matter",
      resourceId: matter.id,
      metadata: {
        clientId: matter.clientId,
        title: matter.title,
        referenceNo: matter.referenceNo
      }
    });

    return matter;
  }
}
