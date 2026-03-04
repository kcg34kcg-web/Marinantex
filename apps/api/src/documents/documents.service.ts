import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import type { DocumentStatus, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import type { AutosaveDocumentDto } from "./dto/autosave-document.dto";
import type { ChangeDocumentStatusDto } from "./dto/change-document-status.dto";
import type { CreateDocumentDto } from "./dto/create-document.dto";
import type { CreateSnapshotDto } from "./dto/create-snapshot.dto";
import type { ListDocumentsQueryDto } from "./dto/list-documents-query.dto";
import type { UpdateDocumentContentDto } from "./dto/update-document-content.dto";
import { DocumentLockService } from "./document-lock.service";
import {
  ensureCanonicalTree,
  toPrismaJsonValue,
} from "./utils/canonical-tree";
import { stableStringify } from "./utils/stable-json";

interface MutationContext {
  actorUserId: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentLockService: DocumentLockService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    tenantId: string,
    actorUserId: string,
    input: CreateDocumentDto,
    meta?: Omit<MutationContext, "actorUserId">,
  ) {
    const schemaVersion = input.schemaVersion ?? 1;
    const canonicalTree = ensureCanonicalTree(
      input.canonicalJson as Parameters<typeof ensureCanonicalTree>[0],
      schemaVersion,
    );
    const canonicalJson = toPrismaJsonValue(canonicalTree);

    const created = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          tenantId,
          ownerId: actorUserId,
          title: input.title,
          type: input.type,
          status: "DRAFT",
          schemaVersion: canonicalTree.schemaVersion,
          canonicalJson,
          latestVersion: 1,
        },
      });

      const snapshotHash = this.hashCanonical(canonicalTree);
      await tx.documentVersion.create({
        data: {
          tenantId,
          documentId: document.id,
          versionNumber: 1,
          schemaVersion: canonicalTree.schemaVersion,
          canonicalJson,
          snapshotHash,
          isFinalSnapshot: false,
          createdById: actorUserId,
        },
      });

      return {
        id: document.id,
        tenantId: document.tenantId,
        title: document.title,
        type: document.type,
        status: document.status,
        schemaVersion: document.schemaVersion,
        latestVersion: document.latestVersion,
      };
    });

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "DOCUMENT_CREATED",
      objectType: "DOCUMENT",
      objectId: created.id,
      requestId: meta?.requestId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        schemaVersion: created.schemaVersion,
        latestVersion: created.latestVersion,
      },
      dataClassification: "sensitive_case",
    });

    return created;
  }

  async list(tenantId: string, query: ListDocumentsQueryDto) {
    const take = Math.min(query.limit ?? 20, 100);
    return this.prisma.document.findMany({
      where: {
        tenantId,
        status: query.status,
        type: query.type,
      },
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        id: true,
        tenantId: true,
        ownerId: true,
        title: true,
        type: true,
        status: true,
        schemaVersion: true,
        latestVersion: true,
        finalVersionId: true,
        finalizedAt: true,
        updatedAt: true,
      },
    });
  }

  async getById(id: string, tenantId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        ownerId: true,
        title: true,
        type: true,
        status: true,
        schemaVersion: true,
        canonicalJson: true,
        latestVersion: true,
        finalContentHash: true,
        finalVersionId: true,
        finalizedAt: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    return document;
  }

  async autosave(
    id: string,
    tenantId: string,
    actorUserId: string,
    input: AutosaveDocumentDto,
    meta?: Omit<MutationContext, "actorUserId">,
  ) {
    await this.documentLockService.assertLock(tenantId, id, actorUserId);

    const saved = await this.updateContent(id, tenantId, actorUserId, input, {
      skipLockValidation: true,
    });

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "DOCUMENT_AUTOSAVED",
      objectType: "DOCUMENT",
      objectId: id,
      requestId: meta?.requestId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        schemaVersion: input.schemaVersion,
        latestVersion: saved.latestVersion,
      },
      dataClassification: "sensitive_case",
    });

    if (input.recoveredFromCrash) {
      await this.auditService.write({
        tenantId,
        actorUserId,
        action: "DOCUMENT_CRASH_RECOVERED",
        objectType: "DOCUMENT",
        objectId: id,
        requestId: meta?.requestId,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        metadata: {
          latestVersion: saved.latestVersion,
        },
        dataClassification: "sensitive_case",
      });
    }

    return saved;
  }

  async updateTitle(
    id: string,
    tenantId: string,
    actorUserId: string,
    title: string,
    meta?: Omit<MutationContext, "actorUserId">,
  ) {
    await this.ensureDocumentExists(id, tenantId);
    await this.documentLockService.assertLock(tenantId, id, actorUserId);

    const result = await this.prisma.document.update({
      where: { id },
      data: { title },
      select: {
        id: true,
        tenantId: true,
        title: true,
        status: true,
        updatedAt: true,
      },
    });

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "DOCUMENT_UPDATED",
      objectType: "DOCUMENT",
      objectId: id,
      requestId: meta?.requestId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        field: "title",
      },
      dataClassification: "sensitive_case",
    });

    return result;
  }

  async updateContent(
    id: string,
    tenantId: string,
    actorUserId: string,
    input: UpdateDocumentContentDto,
    options?: { skipLockValidation?: boolean },
  ) {
    const document = await this.ensureDocumentExists(id, tenantId);
    if (["FINAL", "ARCHIVED"].includes(document.status)) {
      throw new BadRequestException("Final/Archived document cannot be edited");
    }

    if (!options?.skipLockValidation) {
      await this.documentLockService.assertLock(tenantId, id, actorUserId);
    }

    const canonicalTree = ensureCanonicalTree(
      input.canonicalJson as Parameters<typeof ensureCanonicalTree>[0],
      input.schemaVersion,
    );
    if (canonicalTree.schemaVersion !== input.schemaVersion) {
      throw new BadRequestException(
        "schemaVersion and canonicalJson.schemaVersion mismatch",
      );
    }

    const canonicalJson = toPrismaJsonValue(canonicalTree);

    return this.prisma.$transaction(async (tx) => {
      const lastVersion = await tx.documentVersion.findFirst({
        where: {
          tenantId,
          documentId: id,
        },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });

      const nextVersion = (lastVersion?.versionNumber ?? document.latestVersion) + 1;
      const snapshotHash = this.hashCanonical(canonicalTree);

      await tx.documentVersion.create({
        data: {
          tenantId,
          documentId: id,
          versionNumber: nextVersion,
          schemaVersion: input.schemaVersion,
          canonicalJson,
          snapshotHash,
          isFinalSnapshot: false,
          createdById: actorUserId,
        },
      });

      return tx.document.update({
        where: { id },
        data: {
          title: input.title ?? document.title,
          canonicalJson,
          schemaVersion: input.schemaVersion,
          latestVersion: nextVersion,
        },
        select: {
          id: true,
          tenantId: true,
          title: true,
          status: true,
          schemaVersion: true,
          latestVersion: true,
          updatedAt: true,
        },
      });
    });
  }

  async changeStatus(
    id: string,
    tenantId: string,
    actorUserId: string,
    input: ChangeDocumentStatusDto,
    meta?: Omit<MutationContext, "actorUserId">,
  ) {
    const document = await this.ensureDocumentExists(id, tenantId);
    await this.documentLockService.assertLock(tenantId, id, actorUserId);
    this.assertStatusTransition(document.status, input.status);

    const data: Prisma.DocumentUpdateInput = {
      status: input.status,
    };

    if (input.status === "ARCHIVED") {
      data.archivedAt = new Date();
    }
    if (input.status !== "ARCHIVED") {
      data.archivedAt = null;
    }

    const changed = await this.prisma.document.update({
      where: { id },
      data,
      select: {
        id: true,
        tenantId: true,
        status: true,
        archivedAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "DOCUMENT_STATUS_CHANGED",
      objectType: "DOCUMENT",
      objectId: id,
      requestId: meta?.requestId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        from: document.status,
        to: input.status,
      },
      dataClassification: "sensitive_case",
    });

    return changed;
  }

  async createSnapshot(
    id: string,
    tenantId: string,
    actorUserId: string,
    input: CreateSnapshotDto,
  ) {
    const document = await this.ensureDocumentExists(id, tenantId);
    await this.documentLockService.assertLock(tenantId, id, actorUserId);
    if (["FINAL", "ARCHIVED"].includes(document.status) && !input.isFinalSnapshot) {
      throw new BadRequestException(
        "Manual non-final snapshot is not allowed for immutable document",
      );
    }

    const tree = ensureCanonicalTree(
      document.canonicalJson as unknown as Parameters<typeof ensureCanonicalTree>[0],
      document.schemaVersion,
    );
    const canonicalJson = toPrismaJsonValue(tree);
    const snapshotHash = this.hashCanonical(tree);

    const version = await this.prisma.$transaction(async (tx) => {
      const lastVersion = await tx.documentVersion.findFirst({
        where: {
          tenantId,
          documentId: id,
        },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      const nextVersion = (lastVersion?.versionNumber ?? document.latestVersion) + 1;

      const createdVersion = await tx.documentVersion.create({
        data: {
          tenantId,
          documentId: id,
          versionNumber: nextVersion,
          schemaVersion: document.schemaVersion,
          canonicalJson,
          snapshotHash,
          isFinalSnapshot: Boolean(input.isFinalSnapshot),
          createdById: actorUserId,
        },
        select: {
          id: true,
          versionNumber: true,
          snapshotHash: true,
          isFinalSnapshot: true,
          createdAt: true,
        },
      });

      await tx.document.update({
        where: { id },
        data: { latestVersion: nextVersion },
      });

      return createdVersion;
    });

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "DOCUMENT_VERSION_CREATED",
      objectType: "DOCUMENT_VERSION",
      objectId: version.id,
      metadata: {
        documentId: id,
        versionNumber: version.versionNumber,
        isFinalSnapshot: version.isFinalSnapshot,
      },
      dataClassification: "sensitive_case",
    });

    return version;
  }

  async listVersions(id: string, tenantId: string) {
    await this.ensureDocumentExists(id, tenantId);
    return this.prisma.documentVersion.findMany({
      where: { tenantId, documentId: id },
      orderBy: { versionNumber: "desc" },
      select: {
        id: true,
        versionNumber: true,
        schemaVersion: true,
        snapshotHash: true,
        isFinalSnapshot: true,
        createdById: true,
        createdAt: true,
      },
    });
  }

  async finalize(
    id: string,
    tenantId: string,
    actorUserId: string,
    meta?: Omit<MutationContext, "actorUserId">,
  ) {
    const document = await this.ensureDocumentExists(id, tenantId);
    await this.documentLockService.assertLock(tenantId, id, actorUserId);
    if (!["DRAFT", "REVIEW"].includes(document.status)) {
      throw new BadRequestException("Only Draft/Review documents can be finalized");
    }

    const tree = ensureCanonicalTree(
      document.canonicalJson as unknown as Parameters<typeof ensureCanonicalTree>[0],
      document.schemaVersion,
    );
    const canonicalJson = toPrismaJsonValue(tree);
    const snapshotHash = this.hashCanonical(tree);

    const finalized = await this.prisma.$transaction(async (tx) => {
      const lastVersion = await tx.documentVersion.findFirst({
        where: {
          documentId: document.id,
          tenantId,
        },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });

      const nextVersion = (lastVersion?.versionNumber ?? document.latestVersion) + 1;

      const version = await tx.documentVersion.create({
        data: {
          tenantId,
          documentId: document.id,
          versionNumber: nextVersion,
          schemaVersion: document.schemaVersion,
          canonicalJson,
          snapshotHash,
          isFinalSnapshot: true,
          createdById: actorUserId,
        },
        select: { id: true },
      });

      return tx.document.update({
        where: { id },
        data: {
          latestVersion: nextVersion,
          status: "FINAL",
          finalVersionId: version.id,
          finalContentHash: snapshotHash,
          finalizedAt: new Date(),
        },
        select: {
          id: true,
          tenantId: true,
          status: true,
          latestVersion: true,
          finalVersionId: true,
          finalContentHash: true,
          finalizedAt: true,
        },
      });
    });

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "DOCUMENT_FINALIZED",
      objectType: "DOCUMENT",
      objectId: id,
      requestId: meta?.requestId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        finalVersionId: finalized.finalVersionId,
        finalContentHash: finalized.finalContentHash,
      },
      dataClassification: "final_document",
    });

    return finalized;
  }

  async forkDraftFromFinal(
    id: string,
    tenantId: string,
    actorUserId: string,
    meta?: Omit<MutationContext, "actorUserId">,
  ) {
    const source = await this.ensureDocumentExists(id, tenantId);
    if (!["FINAL", "ARCHIVED"].includes(source.status)) {
      throw new BadRequestException(
        "Draft fork can only be created from Final/Archived documents",
      );
    }

    const tree = ensureCanonicalTree(
      source.canonicalJson as unknown as Parameters<typeof ensureCanonicalTree>[0],
      source.schemaVersion,
    );
    const canonicalJson = toPrismaJsonValue(tree);
    const snapshotHash = this.hashCanonical(tree);

    const titleSuffix = source.status === "FINAL" ? "Draft Copy" : "Reopened Draft";
    const cloned = await this.prisma.$transaction(async (tx) => {
      const newDocument = await tx.document.create({
        data: {
          tenantId,
          ownerId: actorUserId,
          title: `${source.title} - ${titleSuffix}`,
          type: source.type,
          status: "DRAFT",
          schemaVersion: source.schemaVersion,
          canonicalJson,
          latestVersion: 1,
        },
        select: {
          id: true,
          tenantId: true,
          title: true,
          type: true,
          status: true,
          schemaVersion: true,
          latestVersion: true,
        },
      });

      await tx.documentVersion.create({
        data: {
          tenantId,
          documentId: newDocument.id,
          versionNumber: 1,
          schemaVersion: source.schemaVersion,
          canonicalJson,
          snapshotHash,
          isFinalSnapshot: false,
          createdById: actorUserId,
        },
      });

      return newDocument;
    });

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "DOCUMENT_CREATED",
      objectType: "DOCUMENT",
      objectId: cloned.id,
      requestId: meta?.requestId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        sourceDocumentId: source.id,
        sourceStatus: source.status,
        sourceVersion: source.latestVersion,
        schemaVersion: cloned.schemaVersion,
      },
      dataClassification: "sensitive_case",
    });

    return cloned;
  }

  private hashCanonical(value: unknown): string {
    return createHash("sha256").update(stableStringify(value)).digest("hex");
  }

  private assertStatusTransition(current: DocumentStatus, next: DocumentStatus): void {
    if (current === next) {
      return;
    }

    const allowed: Record<DocumentStatus, DocumentStatus[]> = {
      DRAFT: ["REVIEW", "ARCHIVED"],
      REVIEW: ["DRAFT", "ARCHIVED", "FINAL"],
      FINAL: ["ARCHIVED"],
      ARCHIVED: ["DRAFT"],
    };

    if (!allowed[current].includes(next)) {
      throw new BadRequestException(
        `Invalid status transition: ${current} -> ${next}`,
      );
    }
  }

  private async ensureDocumentExists(id: string, tenantId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        title: true,
        type: true,
        status: true,
        schemaVersion: true,
        canonicalJson: true,
        latestVersion: true,
      },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    return document;
  }
}
