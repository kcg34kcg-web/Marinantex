import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DocumentLockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async acquire(
    tenantId: string,
    documentId: string,
    userId: string,
    leaseSeconds = 120,
  ) {
    await this.ensureDocument(tenantId, documentId);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + leaseSeconds * 1000);
    const lock = await this.prisma.documentLock.findUnique({
      where: { documentId },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        expiresAt: true,
      },
    });

    if (lock && lock.tenantId !== tenantId) {
      throw new NotFoundException("Document not found");
    }

    if (lock && lock.expiresAt > now && lock.userId !== userId) {
      throw new ConflictException("Document is locked by another user");
    }

    const persisted = lock
      ? await this.prisma.documentLock.update({
          where: { documentId },
          data: {
            userId,
            expiresAt,
            acquiredAt: now,
          },
          select: {
            id: true,
            documentId: true,
            userId: true,
            acquiredAt: true,
            expiresAt: true,
            updatedAt: true,
          },
        })
      : await this.prisma.documentLock.create({
          data: {
            tenantId,
            documentId,
            userId,
            acquiredAt: now,
            expiresAt,
          },
          select: {
            id: true,
            documentId: true,
            userId: true,
            acquiredAt: true,
            expiresAt: true,
            updatedAt: true,
          },
        });

    await this.auditService.write({
      tenantId,
      actorUserId: userId,
      action: "DOCUMENT_LOCK_ACQUIRED",
      objectType: "DOCUMENT",
      objectId: documentId,
      metadata: {
        leaseSeconds,
        expiresAt: persisted.expiresAt.toISOString(),
      },
      dataClassification: "sensitive_case",
    });

    return persisted;
  }

  async refresh(
    tenantId: string,
    documentId: string,
    userId: string,
    leaseSeconds = 120,
  ) {
    await this.ensureDocument(tenantId, documentId);

    const now = new Date();
    const lock = await this.prisma.documentLock.findUnique({
      where: { documentId },
      select: { id: true, tenantId: true, userId: true, expiresAt: true },
    });

    if (!lock || lock.tenantId !== tenantId) {
      throw new ConflictException("No active lock to refresh");
    }
    if (lock.userId !== userId) {
      throw new ConflictException("Document lock is owned by another user");
    }
    if (lock.expiresAt <= now) {
      throw new ConflictException("Document lock expired");
    }

    const expiresAt = new Date(now.getTime() + leaseSeconds * 1000);
    const persisted = await this.prisma.documentLock.update({
      where: { documentId },
      data: { expiresAt },
      select: {
        id: true,
        documentId: true,
        userId: true,
        acquiredAt: true,
        expiresAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.write({
      tenantId,
      actorUserId: userId,
      action: "DOCUMENT_LOCK_REFRESHED",
      objectType: "DOCUMENT",
      objectId: documentId,
      metadata: {
        leaseSeconds,
        expiresAt: persisted.expiresAt.toISOString(),
      },
      dataClassification: "sensitive_case",
    });

    return persisted;
  }

  async release(tenantId: string, documentId: string, userId: string) {
    await this.ensureDocument(tenantId, documentId);
    const lock = await this.prisma.documentLock.findUnique({
      where: { documentId },
      select: { id: true, tenantId: true, userId: true },
    });

    if (!lock || lock.tenantId !== tenantId) {
      return { released: false };
    }
    if (lock.userId !== userId) {
      throw new ConflictException("Only lock owner can release lock");
    }

    await this.prisma.documentLock.delete({
      where: { documentId },
    });

    await this.auditService.write({
      tenantId,
      actorUserId: userId,
      action: "DOCUMENT_LOCK_RELEASED",
      objectType: "DOCUMENT",
      objectId: documentId,
      dataClassification: "sensitive_case",
    });

    return { released: true };
  }

  async assertLock(
    tenantId: string,
    documentId: string,
    userId: string,
  ): Promise<void> {
    const now = new Date();
    const lock = await this.prisma.documentLock.findUnique({
      where: { documentId },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        expiresAt: true,
      },
    });

    if (!lock) {
      return;
    }
    if (lock.tenantId !== tenantId) {
      throw new NotFoundException("Document not found");
    }

    if (lock.expiresAt <= now) {
      await this.prisma.documentLock.delete({ where: { documentId } });
      return;
    }

    if (lock.userId !== userId) {
      throw new ConflictException("Document currently locked by another user");
    }
  }

  async getCurrent(tenantId: string, documentId: string) {
    await this.ensureDocument(tenantId, documentId);
    const lock = await this.prisma.documentLock.findUnique({
      where: { documentId },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        acquiredAt: true,
        expiresAt: true,
        updatedAt: true,
      },
    });
    if (!lock || lock.tenantId !== tenantId) {
      return null;
    }
    if (lock.expiresAt <= new Date()) {
      await this.prisma.documentLock.delete({ where: { documentId } });
      return null;
    }
    return lock;
  }

  private async ensureDocument(tenantId: string, documentId: string) {
    const found = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException("Document not found");
    }
  }
}
