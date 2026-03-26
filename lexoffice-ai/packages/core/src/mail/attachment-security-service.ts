import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@lexoffice/db";
import {
  attachmentVirusScanJobSchema,
  createAttachmentDownloadTokenSchema,
  createAttachmentUploadUrlSchema,
  sendMailSchema,
  type AttachmentVirusScanJobPayload
} from "@lexoffice/contracts";
import { JOB_NAMES, QUEUES } from "../jobs/queue-constants";
import { AuditService } from "../audit/audit-service";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "../errors/app-error";
import { verifyPayloadToken, signPayloadToken } from "../security/signed-token";
import { createVirusScanner, type VirusScanner } from "../security/virus-scanner";
import {
  AttachmentObjectStore,
  encodeAttachmentStorageLocator
} from "../storage/attachment-object-store";

type UploadTokenPayload = {
  tenantId: string;
  mailboxId: string;
  actorUserId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageLocator: string;
};

type StagedAttachmentTokenPayload = UploadTokenPayload;

type DownloadTokenPayload = {
  tenantId: string;
  attachmentId: string;
  actorUserId: string;
};

type SendMailInput = ReturnType<typeof sendMailSchema.parse>;

type NormalizedAttachment = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  content: Buffer;
  sourceStorageLocator?: string;
};

type AttachmentDownloadResult =
  | {
      kind: "proxy";
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      content: Buffer;
    }
  | {
      kind: "redirect";
      redirectUrl: string;
      expiresAt: Date;
    };

export class AttachmentSecurityService {
  private readonly objectStore: AttachmentObjectStore;

  private virusScanner: VirusScanner | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {
    this.objectStore = new AttachmentObjectStore();
  }

  async createStagedUpload(actorUserId: string, payload: unknown) {
    const input = createAttachmentUploadUrlSchema.parse(payload);
    await this.assertMailboxAccess(input.tenantId, input.mailboxId, actorUserId, "send");
    this.assertAttachmentPolicy(input.fileName, input.mimeType, input.sizeBytes);

    const storageLocator = encodeAttachmentStorageLocator(
      "quarantine",
      buildStagingObjectKey(input.tenantId, actorUserId, input.fileName)
    );

    const tokenPayload: UploadTokenPayload = {
      tenantId: input.tenantId,
      mailboxId: input.mailboxId,
      actorUserId,
      fileName: sanitizeFileName(input.fileName),
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageLocator
    };

    const attachmentToken = signPayloadToken({
      subject: "attachment:staged",
      payload: tokenPayload,
      ttlSeconds: 3 * 60 * 60
    });

    if (this.objectStore.supportsDirectPresignedUpload()) {
      const presigned = await this.objectStore.createPresignedUpload({
        locator: storageLocator,
        mimeType: input.mimeType,
        expiresInSeconds: 15 * 60
      });

      return {
        uploadUrl: presigned.url,
        uploadMethod: presigned.method,
        uploadHeaders: presigned.headers,
        uploadMode: "direct",
        attachmentToken,
        expiresAt: presigned.expiresAt,
        maxSizeBytes: this.maxAttachmentBytes()
      };
    }

    const uploadToken = signPayloadToken({
      subject: "attachment:upload",
      payload: tokenPayload,
      ttlSeconds: 15 * 60
    });

    return {
      uploadUrl: `/api/v1/attachments/staging/upload?token=${encodeURIComponent(uploadToken)}`,
      uploadMethod: "PUT" as const,
      uploadHeaders: {
        "Content-Type": input.mimeType
      },
      uploadMode: "proxy",
      attachmentToken,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      maxSizeBytes: this.maxAttachmentBytes()
    };
  }

  async uploadStagedFile(actorUserId: string, uploadToken: string, content: Buffer, contentType?: string) {
    const tokenPayload = verifyPayloadToken<UploadTokenPayload>({
      token: uploadToken,
      subject: "attachment:upload"
    });

    if (tokenPayload.actorUserId !== actorUserId) {
      throw new UnauthorizedError("Upload token kullanıcı bağlamı ile eşleşmiyor");
    }

    this.assertAttachmentPolicy(tokenPayload.fileName, tokenPayload.mimeType, content.byteLength);

    if (content.byteLength > tokenPayload.sizeBytes) {
      throw new ConflictError("Yüklenen dosya beklenen boyutu aşıyor");
    }

    if (contentType && contentType.length > 0 && contentType !== tokenPayload.mimeType) {
      throw new ConflictError("Dosya MIME türü beklenen değer ile eşleşmiyor");
    }

    await this.objectStore.write(tokenPayload.storageLocator, content, tokenPayload.mimeType);

    return {
      storageLocator: tokenPayload.storageLocator,
      sizeBytes: content.byteLength
    };
  }

  async resolveOutgoingAttachments(actorUserId: string, payload: SendMailInput): Promise<NormalizedAttachment[]> {
    const normalized: NormalizedAttachment[] = [];

    for (const attachment of payload.attachments) {
      if (attachment.kind === "staged") {
        const stagedPayload = verifyPayloadToken<StagedAttachmentTokenPayload>({
          token: attachment.attachmentToken,
          subject: "attachment:staged"
        });

        if (
          stagedPayload.tenantId !== payload.tenantId ||
          stagedPayload.mailboxId !== payload.mailboxId ||
          stagedPayload.actorUserId !== actorUserId
        ) {
          throw new UnauthorizedError("Staged attachment token geçersiz tenant/user bağlamına ait");
        }

        const stagedContent = await this.objectStore.read(stagedPayload.storageLocator);
        this.assertAttachmentPolicy(stagedPayload.fileName, stagedPayload.mimeType, stagedContent.byteLength);

        normalized.push({
          fileName: stagedPayload.fileName,
          mimeType: stagedPayload.mimeType,
          sizeBytes: stagedContent.byteLength,
          content: stagedContent,
          sourceStorageLocator: stagedPayload.storageLocator
        });

        continue;
      }

      const safeName = sanitizeFileName(attachment.name);
      const decoded = decodeBase64Attachment(attachment.contentBase64);
      this.assertAttachmentPolicy(safeName, attachment.mimeType, decoded.byteLength);

      normalized.push({
        fileName: safeName,
        mimeType: attachment.mimeType,
        sizeBytes: decoded.byteLength,
        content: decoded
      });
    }

    return normalized;
  }

  async persistSentAttachments(params: {
    tenantId: string;
    actorUserId: string;
    messageId: string;
    mailboxId: string;
    attachments: NormalizedAttachment[];
  }): Promise<{
    attachments: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: bigint }>;
    scanJobs: AttachmentVirusScanJobPayload[];
  }> {
    if (params.attachments.length === 0) {
      return {
        attachments: [],
        scanJobs: []
      };
    }

    const createdAttachments: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: bigint }> = [];
    const scanJobs: AttachmentVirusScanJobPayload[] = [];

    for (const item of params.attachments) {
      const fileName = sanitizeFileName(item.fileName);
      const quarantineLocator = encodeAttachmentStorageLocator(
        "quarantine",
        buildQuarantineAttachmentKey(params.tenantId, params.messageId, fileName)
      );

      if (item.sourceStorageLocator) {
        await this.objectStore.move(item.sourceStorageLocator, quarantineLocator, item.mimeType);
      } else {
        await this.objectStore.write(quarantineLocator, item.content, item.mimeType);
      }

      const checksum = createHash("sha256").update(item.content).digest("hex");

      const attachment = await this.prisma.mailAttachment.create({
        data: {
          tenantId: params.tenantId,
          messageId: params.messageId,
          fileName,
          mimeType: item.mimeType,
          sizeBytes: BigInt(item.sizeBytes),
          storageKey: quarantineLocator,
          checksumSha256: checksum,
          virusScanStatus: "PENDING"
        },
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true
        }
      });

      createdAttachments.push(attachment);

      const scanJob: AttachmentVirusScanJobPayload = {
        tenantId: params.tenantId,
        attachmentId: attachment.id,
        correlationId: randomUUID(),
        triggeredByUserId: params.actorUserId
      };

      scanJobs.push(scanJob);

      await this.prisma.backgroundJob.create({
        data: {
          tenantId: params.tenantId,
          jobType: JOB_NAMES.ATTACHMENT_VIRUS_SCAN,
          queueName: QUEUES.ATTACHMENTS,
          status: "QUEUED",
          payload: scanJob,
          correlationId: scanJob.correlationId,
          externalJobId: `scan:${attachment.id}`,
          runAt: new Date()
        }
      });
    }

    await this.prisma.mailThread.updateMany({
      where: {
        tenantId: params.tenantId,
        mailboxId: params.mailboxId,
        messages: {
          some: {
            id: params.messageId
          }
        }
      },
      data: {
        hasAttachments: true
      }
    });

    await this.auditService.log({
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      action: "mail.attachment.persisted",
      resourceType: "mail_message",
      resourceId: params.messageId,
      metadata: {
        attachmentCount: createdAttachments.length
      }
    });

    return {
      attachments: createdAttachments,
      scanJobs
    };
  }

  async createSignedDownloadToken(actorUserId: string, payload: unknown) {
    const input = createAttachmentDownloadTokenSchema.parse(payload);

    await this.assertAttachmentAccess(input.tenantId, input.attachmentId, actorUserId, "read");

    const token = signPayloadToken({
      subject: "attachment:download",
      payload: {
        tenantId: input.tenantId,
        attachmentId: input.attachmentId,
        actorUserId
      },
      ttlSeconds: 5 * 60
    });

    return {
      token,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    };
  }

  async downloadAttachmentByToken(sessionUserId: string, signedToken: string): Promise<AttachmentDownloadResult> {
    const payload = verifyPayloadToken<DownloadTokenPayload>({
      token: signedToken,
      subject: "attachment:download"
    });

    if (payload.actorUserId !== sessionUserId) {
      throw new UnauthorizedError("İmzalı attachment URL kullanıcı bağlamı ile eşleşmiyor");
    }

    const attachment = await this.assertAttachmentAccess(
      payload.tenantId,
      payload.attachmentId,
      payload.actorUserId,
      "read"
    );

    if (!attachment.storageKey) {
      throw new NotFoundError("Attachment storage kaydı bulunamadı");
    }

    if (attachment.virusScanStatus !== "CLEAN") {
      throw new ForbiddenError("Attachment virüs taramasından geçmeden indirilemez");
    }

    if (this.objectStore.isS3Driver()) {
      const signed = await this.objectStore.createPresignedDownload({
        locator: attachment.storageKey,
        fileName: attachment.fileName,
        expiresInSeconds: 5 * 60
      });

      return {
        kind: "redirect",
        redirectUrl: signed.url,
        expiresAt: signed.expiresAt
      };
    }

    const buffer = await this.objectStore.read(attachment.storageKey);

    return {
      kind: "proxy",
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: Number(attachment.sizeBytes),
      content: buffer
    };
  }

  async runVirusScanJob(payload: AttachmentVirusScanJobPayload): Promise<{
    attachmentId: string;
    status: "CLEAN" | "INFECTED" | "ERROR";
    dlpFlag: boolean;
    correlationId: string;
  }> {
    const input = attachmentVirusScanJobSchema.parse(payload);

    const attachment = await this.prisma.mailAttachment.findFirst({
      where: {
        id: input.attachmentId,
        tenantId: input.tenantId
      },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        storageKey: true,
        tenantId: true,
        messageId: true
      }
    });

    if (!attachment) {
      throw new NotFoundError("Virus scan için attachment bulunamadı");
    }

    if (!attachment.storageKey) {
      await this.prisma.mailAttachment.update({
        where: { id: attachment.id },
        data: {
          virusScanStatus: "ERROR"
        }
      });

      return {
        attachmentId: attachment.id,
        status: "ERROR",
        dlpFlag: false,
        correlationId: input.correlationId
      };
    }

    let status: "CLEAN" | "INFECTED" | "ERROR" = "ERROR";
    let dlpFlag = false;
    let scannerEngine: string | undefined;
    let scannerSignature: string | undefined;
    let scannerDetails: string | undefined;
    let nextStorageLocator: string = attachment.storageKey;

    try {
      const content = await this.objectStore.read(attachment.storageKey);
      dlpFlag = detectSensitiveData(content);

      const scanResult = await this.getVirusScanner().scan({
        tenantId: input.tenantId,
        attachmentId: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        content
      });

      status = scanResult.status;
      scannerEngine = scanResult.engine;
      scannerSignature = scanResult.signature;
      scannerDetails = scanResult.details;

      if (status === "CLEAN") {
        const cleanLocator = encodeAttachmentStorageLocator(
          "clean",
          buildCleanAttachmentKey(attachment.tenantId, attachment.messageId, attachment.fileName)
        );
        await this.objectStore.move(attachment.storageKey, cleanLocator, attachment.mimeType);
        nextStorageLocator = cleanLocator;
      }
    } catch (error) {
      status = "ERROR";
      scannerDetails = error instanceof Error ? error.message : "Virus scan job bilinmeyen hata";
    }

    await this.prisma.mailAttachment.update({
      where: {
        id: attachment.id
      },
      data: {
        virusScanStatus: status,
        dlpFlag,
        storageKey: nextStorageLocator
      }
    });

    await this.auditService.log({
      tenantId: attachment.tenantId,
      ...(input.triggeredByUserId ? { actorUserId: input.triggeredByUserId } : {}),
      action:
        status === "CLEAN"
          ? "mail.attachment.scan.clean"
          : status === "INFECTED"
            ? "mail.attachment.scan.infected"
            : "mail.attachment.scan.error",
      resourceType: "mail_attachment",
      resourceId: attachment.id,
      metadata: {
        correlationId: input.correlationId,
        fileName: attachment.fileName,
        dlpFlag,
        status,
        ...(scannerEngine ? { scannerEngine } : {}),
        ...(scannerSignature ? { scannerSignature } : {}),
        ...(scannerDetails ? { scannerDetails } : {})
      }
    });

    return {
      attachmentId: attachment.id,
      status,
      dlpFlag,
      correlationId: input.correlationId
    };
  }

  private async assertMailboxAccess(
    tenantId: string,
    mailboxId: string,
    userId: string,
    mode: "read" | "send"
  ): Promise<void> {
    const mailbox = await this.prisma.mailbox.findFirst({
      where: {
        id: mailboxId,
        tenantId,
        deletedAt: null
      },
      select: {
        id: true
      }
    });

    if (!mailbox) {
      throw new NotFoundError("Mailbox bulunamadı");
    }

    const permission = await this.prisma.mailboxPermission.findFirst({
      where: {
        tenantId,
        mailboxId,
        userId,
        ...(mode === "read" ? { canRead: true } : { canSend: true })
      },
      select: {
        id: true
      }
    });

    if (!permission) {
      throw new ForbiddenError("Mailbox attachment işlemi için yetkiniz yok");
    }
  }

  private async assertAttachmentAccess(
    tenantId: string,
    attachmentId: string,
    userId: string,
    mode: "read"
  ) {
    const attachment = await this.prisma.mailAttachment.findFirst({
      where: {
        id: attachmentId,
        tenantId
      },
      include: {
        message: {
          select: {
            mailboxId: true,
            deletedAt: true
          }
        }
      }
    });

    if (!attachment || attachment.message.deletedAt) {
      throw new NotFoundError("Attachment bulunamadı");
    }

    await this.assertMailboxAccess(tenantId, attachment.message.mailboxId, userId, mode);

    return attachment;
  }

  private assertAttachmentPolicy(fileName: string, mimeType: string, sizeBytes: number): void {
    const safeName = sanitizeFileName(fileName);
    if (safeName.length === 0) {
      throw new ConflictError("Dosya adı geçersiz");
    }

    if (sizeBytes <= 0 || sizeBytes > this.maxAttachmentBytes()) {
      throw new ConflictError("Attachment boyutu izin verilen sınırın dışında");
    }

    const allowed = this.allowedMimeTypes();
    if (!allowed.has("*/*") && !allowed.has(mimeType.toLowerCase())) {
      throw new ForbiddenError(`Bu MIME türü yükleme politikasına izinli değil: ${mimeType}`);
    }

    const extension = safeName.includes(".") ? safeName.split(".").at(-1)?.toLowerCase() : undefined;
    if (extension && BLOCKED_EXTENSIONS.has(extension)) {
      throw new ForbiddenError("Bu dosya uzantısı güvenlik politikası nedeniyle engellendi");
    }
  }

  private maxAttachmentBytes(): number {
    const value = Number(process.env.ATTACHMENT_MAX_SIZE_BYTES ?? 25 * 1024 * 1024);
    if (!Number.isFinite(value) || value <= 0) {
      return 25 * 1024 * 1024;
    }

    return value;
  }

  private allowedMimeTypes(): Set<string> {
    const configured = process.env.ATTACHMENT_ALLOWED_MIME;
    if (!configured || configured.trim().length === 0) {
      return new Set(DEFAULT_ALLOWED_MIME);
    }

    return new Set(
      configured
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0)
    );
  }

  private getVirusScanner(): VirusScanner {
    if (!this.virusScanner) {
      this.virusScanner = createVirusScanner();
    }

    return this.virusScanner;
  }
}

const DEFAULT_ALLOWED_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp"
];

const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "msi",
  "bat",
  "cmd",
  "com",
  "js",
  "jse",
  "vbs",
  "ps1",
  "jar",
  "scr"
]);

function decodeBase64Attachment(value: string): Buffer {
  const normalized = value.replace(/\s+/g, "");

  try {
    return Buffer.from(normalized, "base64");
  } catch {
    throw new ConflictError("Attachment base64 içeriği çözümlenemedi");
  }
}

function buildStagingObjectKey(tenantId: string, actorUserId: string, fileName: string): string {
  const safeName = sanitizeFileName(fileName);
  return `tenant/${tenantId}/mail/staging/${actorUserId}/${Date.now()}-${randomUUID()}-${safeName}`;
}

function buildQuarantineAttachmentKey(tenantId: string, messageId: string, fileName: string): string {
  const safeName = sanitizeFileName(fileName);
  return `tenant/${tenantId}/mail/quarantine/messages/${messageId}/${randomUUID()}-${safeName}`;
}

function buildCleanAttachmentKey(tenantId: string, messageId: string, fileName: string): string {
  const safeName = sanitizeFileName(fileName);
  return `tenant/${tenantId}/mail/clean/messages/${messageId}/${randomUUID()}-${safeName}`;
}

function sanitizeFileName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\r\n]/g, " ")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .trim()
    .slice(0, 200);
}

function detectSensitiveData(content: Buffer): boolean {
  const text = content.subarray(0, Math.min(content.byteLength, 64_000)).toString("utf8");

  const tcKimlikRegex = /\b[1-9][0-9]{10}\b/;
  const ibanRegex = /\bTR[0-9]{2}[0-9A-Z]{5}[0-9A-Z]{17}\b/i;
  const cardRegex = /\b(?:\d[ -]*?){13,16}\b/;

  return tcKimlikRegex.test(text) || ibanRegex.test(text) || cardRegex.test(text);
}
