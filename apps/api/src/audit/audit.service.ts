import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import type { AuditAction, AuditObjectType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

interface WriteAuditInput {
  tenantId: string;
  actorUserId?: string;
  action: AuditAction;
  objectType: AuditObjectType;
  objectId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
  dataClassification?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async write(input: WriteAuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId ?? null,
          action: input.action,
          objectType: input.objectType,
          objectId: input.objectId ?? null,
          requestId: input.requestId ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgentHash: input.userAgent
            ? createHash("sha256").update(input.userAgent).digest("hex")
            : null,
          metadata: input.metadata ?? undefined,
          dataClassification: input.dataClassification ?? "general",
        },
      });
    } catch (error) {
      this.logger.error("AUDIT_WRITE_FAILED", error as Error);
    }
  }
}
