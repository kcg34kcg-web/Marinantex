import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ExportFormat } from "@prisma/client";
import { createHash } from "crypto";
import { ensureCanonicalTree } from "../documents/utils/canonical-tree";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { DocxRendererService } from "./docx-renderer.service";
import { ExportQueueService } from "./export-queue.service";
import { PdfRendererService } from "./pdf-renderer.service";
import { StorageService } from "./storage.service";
import { renderCanonicalToPrintHtml } from "./utils/canonical-html-renderer";

interface MutationContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class DocumentExportService {
  private readonly downloadUrlTtlSeconds = this.parseEnvInt(
    process.env.EXPORT_URL_TTL_SECONDS,
    300,
  );
  private readonly objectRetentionHours = this.parseEnvInt(
    process.env.EXPORT_OBJECT_RETENTION_HOURS,
    168,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly queueService: ExportQueueService,
    private readonly pdfRenderer: PdfRendererService,
    private readonly docxRenderer: DocxRendererService,
    private readonly storageService: StorageService,
  ) {}

  async getPrintPreview(documentId: string, tenantId: string) {
    const document = await this.ensureDocument(documentId, tenantId);
    const canonicalTree = ensureCanonicalTree(
      document.canonicalJson as unknown as Parameters<typeof ensureCanonicalTree>[0],
      document.schemaVersion,
    );
    const generatedAtIso = new Date().toISOString();
    const html = renderCanonicalToPrintHtml({
      documentTitle: document.title,
      status: document.status,
      generatedAtIso,
      root: canonicalTree as unknown as Record<string, unknown>,
    });

    return {
      documentId: document.id,
      status: document.status,
      schemaVersion: document.schemaVersion,
      generatedAtIso,
      html,
    };
  }

  async requestPdfExport(
    documentId: string,
    tenantId: string,
    actorUserId: string,
    meta?: MutationContext,
  ) {
    return this.requestExport(documentId, tenantId, actorUserId, "PDF", meta);
  }

  async requestDocxExport(
    documentId: string,
    tenantId: string,
    actorUserId: string,
    meta?: MutationContext,
  ) {
    return this.requestExport(documentId, tenantId, actorUserId, "DOCX", meta);
  }

  async processQueuedExport(exportId: string): Promise<void> {
    const exportRecord = await this.prisma.documentExport.findUnique({
      where: { id: exportId },
      select: {
        id: true,
        tenantId: true,
        documentId: true,
        requestedById: true,
        format: true,
        status: true,
        document: {
          select: {
            id: true,
            title: true,
            status: true,
            schemaVersion: true,
            canonicalJson: true,
          },
        },
      },
    });

    if (!exportRecord) {
      return;
    }

    if (exportRecord.status === "COMPLETED" || exportRecord.status === "EXPIRED") {
      return;
    }

    await this.prisma.documentExport.update({
      where: { id: exportRecord.id },
      data: {
        status: "PROCESSING",
        startedAt: new Date(),
        failureReason: null,
      },
    });

    await this.auditService.write({
      tenantId: exportRecord.tenantId,
      actorUserId: exportRecord.requestedById,
      action: "DOCUMENT_EXPORT_STARTED",
      objectType: "DOCUMENT_EXPORT",
      objectId: exportRecord.id,
      metadata: {
        documentId: exportRecord.documentId,
        format: exportRecord.format,
      },
      dataClassification: "sensitive_case",
    });

    try {
      const canonicalTree = ensureCanonicalTree(
        exportRecord.document.canonicalJson as unknown as Parameters<
          typeof ensureCanonicalTree
        >[0],
        exportRecord.document.schemaVersion,
      );

      const payload = await this.renderPayload(
        exportRecord.format,
        exportRecord.document.title,
        exportRecord.document.status,
        canonicalTree as unknown as Record<string, unknown>,
      );

      const objectKey = `${exportRecord.tenantId}/${exportRecord.documentId}/exports/${exportRecord.id}.${payload.fileExtension}`;
      await this.storageService.uploadObject(
        objectKey,
        payload.buffer,
        payload.contentType,
      );

      const checksum = createHash("sha256").update(payload.buffer).digest("hex");
      const fileSizeBytes = payload.buffer.byteLength;
      const completedAt = new Date();
      const expiresAt = new Date(
        completedAt.getTime() + this.objectRetentionHours * 60 * 60 * 1000,
      );

      await this.prisma.documentExport.update({
        where: { id: exportRecord.id },
        data: {
          status: "COMPLETED",
          storageKey: objectKey,
          checksum,
          fileSizeBytes,
          completedAt,
          expiresAt,
          failureReason: null,
        },
      });

      await this.auditService.write({
        tenantId: exportRecord.tenantId,
        actorUserId: exportRecord.requestedById,
        action: "DOCUMENT_EXPORT_COMPLETED",
        objectType: "DOCUMENT_EXPORT",
        objectId: exportRecord.id,
        metadata: {
          documentId: exportRecord.documentId,
          format: exportRecord.format,
          checksum,
          fileSizeBytes,
          expiresAt: expiresAt.toISOString(),
        },
        dataClassification: "final_document",
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown export error";

      await this.prisma.documentExport.update({
        where: { id: exportRecord.id },
        data: {
          status: "FAILED",
          failureReason: reason.slice(0, 1000),
        },
      });

      await this.auditService.write({
        tenantId: exportRecord.tenantId,
        actorUserId: exportRecord.requestedById,
        action: "DOCUMENT_EXPORT_FAILED",
        objectType: "DOCUMENT_EXPORT",
        objectId: exportRecord.id,
        metadata: {
          documentId: exportRecord.documentId,
          format: exportRecord.format,
          reason: reason.slice(0, 1000),
        },
        dataClassification: "sensitive_case",
      });

      throw error;
    }
  }

  async listExports(documentId: string, tenantId: string) {
    await this.ensureDocument(documentId, tenantId);

    return this.prisma.documentExport.findMany({
      where: {
        tenantId,
        documentId,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        documentId: true,
        format: true,
        status: true,
        queueJobId: true,
        checksum: true,
        fileSizeBytes: true,
        failureReason: true,
        startedAt: true,
        completedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  async issueSignedDownloadUrl(
    documentId: string,
    exportId: string,
    tenantId: string,
    actorUserId: string,
    meta?: MutationContext,
  ) {
    const exportRecord = await this.prisma.documentExport.findFirst({
      where: {
        id: exportId,
        tenantId,
        documentId,
      },
      select: {
        id: true,
        documentId: true,
        format: true,
        status: true,
        storageKey: true,
        completedAt: true,
        expiresAt: true,
        document: {
          select: {
            title: true,
          },
        },
      },
    });

    if (!exportRecord) {
      throw new NotFoundException("Export not found");
    }

    if (exportRecord.status !== "COMPLETED" || !exportRecord.storageKey) {
      throw new BadRequestException("Export is not ready for download");
    }

    if (exportRecord.expiresAt && exportRecord.expiresAt.getTime() <= Date.now()) {
      await this.prisma.documentExport.update({
        where: { id: exportRecord.id },
        data: {
          status: "EXPIRED",
        },
      });
      throw new BadRequestException("Export expired");
    }

    const fileName = this.buildFileName(
      exportRecord.document.title,
      exportRecord.id,
      exportRecord.format,
    );
    const signedUrl = await this.storageService.getSignedDownloadUrl(
      exportRecord.storageKey,
      fileName,
      this.downloadUrlTtlSeconds,
      this.contentTypeForFormat(exportRecord.format),
    );

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "DOCUMENT_EXPORT_DOWNLOAD_URL_ISSUED",
      objectType: "DOCUMENT_EXPORT",
      objectId: exportRecord.id,
      requestId: meta?.requestId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        documentId,
        ttlSeconds: this.downloadUrlTtlSeconds,
        format: exportRecord.format,
      },
      dataClassification: "final_document",
    });

    return {
      exportId: exportRecord.id,
      documentId: exportRecord.documentId,
      format: exportRecord.format,
      signedUrl,
      expiresInSeconds: this.downloadUrlTtlSeconds,
      completedAt: exportRecord.completedAt,
    };
  }

  async markDownloaded(
    documentId: string,
    exportId: string,
    tenantId: string,
    actorUserId: string,
    meta?: MutationContext,
  ) {
    const exportRecord = await this.prisma.documentExport.findFirst({
      where: {
        id: exportId,
        tenantId,
        documentId,
      },
      select: {
        id: true,
        format: true,
        status: true,
      },
    });

    if (!exportRecord) {
      throw new NotFoundException("Export not found");
    }

    if (exportRecord.status !== "COMPLETED") {
      throw new BadRequestException("Export is not downloadable");
    }

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "DOCUMENT_EXPORT_DOWNLOADED",
      objectType: "DOCUMENT_EXPORT",
      objectId: exportRecord.id,
      requestId: meta?.requestId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        documentId,
        format: exportRecord.format,
      },
      dataClassification: "final_document",
    });

    return {
      recorded: true,
    };
  }

  private async requestExport(
    documentId: string,
    tenantId: string,
    actorUserId: string,
    format: ExportFormat,
    meta?: MutationContext,
  ) {
    await this.ensureDocument(documentId, tenantId);

    const created = await this.prisma.documentExport.create({
      data: {
        tenantId,
        documentId,
        requestedById: actorUserId,
        format,
        status: "QUEUED",
      },
      select: {
        id: true,
        documentId: true,
        format: true,
        status: true,
        queueJobId: true,
        createdAt: true,
      },
    });

    const job = await this.queueService.enqueuePdfExport({ exportId: created.id });

    const queued = await this.prisma.documentExport.update({
      where: { id: created.id },
      data: {
        queueJobId: String(job.id),
      },
      select: {
        id: true,
        documentId: true,
        format: true,
        status: true,
        queueJobId: true,
        createdAt: true,
      },
    });

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "DOCUMENT_EXPORT_REQUESTED",
      objectType: "DOCUMENT_EXPORT",
      objectId: queued.id,
      requestId: meta?.requestId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        documentId,
        format: queued.format,
        queueJobId: queued.queueJobId,
      },
      dataClassification: "sensitive_case",
    });

    return queued;
  }

  private async ensureDocument(documentId: string, tenantId: string) {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        tenantId,
      },
      select: {
        id: true,
        tenantId: true,
        title: true,
        status: true,
        schemaVersion: true,
        canonicalJson: true,
      },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    return document;
  }

  private async renderPayload(
    format: ExportFormat,
    title: string,
    status: "DRAFT" | "REVIEW" | "FINAL" | "ARCHIVED",
    root: Record<string, unknown>,
  ): Promise<{ buffer: Buffer; contentType: string; fileExtension: string }> {
    if (format === "DOCX") {
      const docxBuffer = await this.docxRenderer.renderCanonicalToDocxBuffer(title, root);
      return {
        buffer: docxBuffer,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileExtension: "docx",
      };
    }

    const html = renderCanonicalToPrintHtml({
      documentTitle: title,
      status,
      generatedAtIso: new Date().toISOString(),
      root,
    });
    const pdfBuffer = await this.pdfRenderer.renderHtmlToPdfBuffer(html);
    return {
      buffer: pdfBuffer,
      contentType: "application/pdf",
      fileExtension: "pdf",
    };
  }

  private buildFileName(title: string, exportId: string, format: ExportFormat): string {
    const sanitized = title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const prefix = sanitized.length > 0 ? sanitized : "document";
    const extension = format === "DOCX" ? "docx" : "pdf";
    return `${prefix}-${exportId.slice(0, 8)}.${extension}`;
  }

  private contentTypeForFormat(format: ExportFormat): string {
    if (format === "DOCX") {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
    return "application/pdf";
  }

  private parseEnvInt(input: string | undefined, fallback: number): number {
    if (!input) {
      return fallback;
    }
    const value = Number(input);
    if (!Number.isInteger(value) || value <= 0) {
      return fallback;
    }
    return value;
  }
}
