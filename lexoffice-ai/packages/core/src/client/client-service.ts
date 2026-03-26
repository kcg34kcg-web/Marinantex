import type { PrismaClient } from "@lexoffice/db";
import {
  createClientSchema,
  listClientsSchema,
  type CreateClientInput,
  type ListClientsInput
} from "@lexoffice/contracts";
import { AuditService } from "../audit/audit-service";

export class ClientService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {}

  async listClients(payload: ListClientsInput) {
    const input = listClientsSchema.parse(payload);

    return this.prisma.client.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        ...(input.query
          ? {
              OR: [
                {
                  name: {
                    contains: input.query,
                    mode: "insensitive"
                  }
                },
                {
                  code: {
                    contains: input.query,
                    mode: "insensitive"
                  }
                },
                {
                  email: {
                    contains: input.query,
                    mode: "insensitive"
                  }
                }
              ]
            }
          : {})
      },
      orderBy: {
        createdAt: "desc"
      },
      take: input.limit
    });
  }

  async createClient(actorUserId: string, payload: CreateClientInput) {
    const input = createClientSchema.parse(payload);

    const client = await this.prisma.client.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        code: input.code ?? null,
        taxNumber: input.taxNumber ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        status: input.status
      }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "client.created",
      resourceType: "client",
      resourceId: client.id,
      metadata: {
        name: client.name
      }
    });

    return client;
  }
}
