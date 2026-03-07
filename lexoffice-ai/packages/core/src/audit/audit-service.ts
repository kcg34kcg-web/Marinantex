import type { Prisma, PrismaClient } from "@lexoffice/db";
import { createHash } from "node:crypto";

export type AuditInput = {
  tenantId: string;
  actorUserId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
};

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async log(input: AuditInput): Promise<void> {
    const createdAt = new Date();
    const previousEntry = await this.prisma.auditLog.findFirst({
      where: { tenantId: input.tenantId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        immutableHash: true
      }
    });

    const immutableHash = computeImmutableHash({
      previousHash: previousEntry?.immutableHash ?? "GENESIS",
      createdAt,
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata })
    });

    const data: Prisma.AuditLogUncheckedCreateInput = {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
      immutableHash,
      createdAt,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata })
    };

    await this.prisma.auditLog.create({
      data
    });
  }
}

type ImmutableHashPayload = {
  previousHash: string;
  createdAt: Date;
  tenantId: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata?: Prisma.InputJsonValue;
};

function computeImmutableHash(payload: ImmutableHashPayload): string {
  const metadata = payload.metadata === undefined ? "" : stableJsonStringify(payload.metadata);

  const raw = [
    payload.previousHash,
    payload.createdAt.toISOString(),
    payload.tenantId,
    payload.actorUserId ?? "",
    payload.action,
    payload.resourceType,
    payload.resourceId ?? "",
    metadata
  ].join("|");

  return createHash("sha256").update(raw).digest("hex");
}

function stableJsonStringify(value: Prisma.InputJsonValue): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));

  const normalized = entries.map(
    ([key, entryValue]) => `${JSON.stringify(key)}:${stableJsonStringify(entryValue)}`
  );

  return `{${normalized.join(",")}}`;
}
