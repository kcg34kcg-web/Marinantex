import type { Prisma, PrismaClient } from "@lexoffice/db";

type SecuritySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type SecurityEventInput = {
  tenantId: string;
  eventType: string;
  severity: SecuritySeverity;
  description: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  payload?: Prisma.InputJsonValue;
};

export class SecurityEventService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: SecurityEventInput): Promise<void> {
    await this.prisma.securityEvent.create({
      data: {
        tenantId: input.tenantId,
        eventType: input.eventType,
        severity: input.severity,
        description: input.description,
        userId: input.userId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        ...(input.payload === undefined ? {} : { payload: input.payload })
      }
    });
  }
}
