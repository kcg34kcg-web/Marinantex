import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SharePermission } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { ensureCanonicalTree } from "../documents/utils/canonical-tree";
import { renderCanonicalToPrintHtml } from "../exports/utils/canonical-html-renderer";
import { CreateShareLinkCommentDto } from "./dto/create-share-link-comment.dto";
import { CreateShareLinkDto } from "./dto/create-share-link.dto";

interface MutationContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class ShareLinksService {
  private readonly defaultExpiresInHours = 72;
  private readonly appBaseUrl =
    process.env.APP_BASE_URL?.trim() || "http://localhost:3000";

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    tenantId: string,
    documentId: string,
    actorUserId: string,
    input: CreateShareLinkDto,
    meta?: MutationContext,
  ) {
    await this.ensureDocument(tenantId, documentId);

    const token = randomBytes(24).toString("base64url");
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(
      Date.now() +
        (input.expiresInHours ?? this.defaultExpiresInHours) * 60 * 60 * 1000,
    );

    const created = await this.prisma.shareLink.create({
      data: {
        tenantId,
        documentId,
        createdById: actorUserId,
        tokenHash,
        permission: input.permission,
        expiresAt,
        maxViews: input.maxViews ?? null,
      },
      select: {
        id: true,
        documentId: true,
        permission: true,
        expiresAt: true,
        maxViews: true,
        viewCount: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "SHARE_LINK_CREATED",
      objectType: "SHARE_LINK",
      objectId: created.id,
      requestId: meta?.requestId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        documentId,
        permission: created.permission,
        expiresAt: created.expiresAt.toISOString(),
        maxViews: created.maxViews,
      },
      dataClassification: "sensitive_case",
    });

    return {
      ...created,
      token,
      publicUrl: `${this.appBaseUrl}/shared/${token}`,
    };
  }

  async list(tenantId: string, documentId: string) {
    await this.ensureDocument(tenantId, documentId);

    return this.prisma.shareLink.findMany({
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
        permission: true,
        expiresAt: true,
        maxViews: true,
        viewCount: true,
        revokedAt: true,
        lastAccessedAt: true,
        createdAt: true,
      },
    });
  }

  async revoke(
    tenantId: string,
    documentId: string,
    shareLinkId: string,
    actorUserId: string,
    meta?: MutationContext,
  ) {
    await this.ensureDocument(tenantId, documentId);
    const link = await this.prisma.shareLink.findFirst({
      where: {
        id: shareLinkId,
        tenantId,
        documentId,
      },
      select: {
        id: true,
        revokedAt: true,
      },
    });

    if (!link) {
      throw new NotFoundException("Share link not found");
    }

    if (!link.revokedAt) {
      await this.prisma.shareLink.update({
        where: { id: link.id },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    await this.auditService.write({
      tenantId,
      actorUserId,
      action: "SHARE_LINK_REVOKED",
      objectType: "SHARE_LINK",
      objectId: link.id,
      requestId: meta?.requestId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        documentId,
      },
      dataClassification: "sensitive_case",
    });

    return {
      revoked: true,
    };
  }

  async resolvePublic(token: string, meta?: MutationContext) {
    const tokenHash = this.hashToken(token);
    const link = await this.prisma.shareLink.findUnique({
      where: {
        tokenHash,
      },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            schemaVersion: true,
            canonicalJson: true,
          },
        },
        comments: {
          orderBy: {
            createdAt: "asc",
          },
          take: 200,
          select: {
            id: true,
            authorName: true,
            body: true,
            createdAt: true,
          },
        },
      },
    });

    if (!link) {
      throw new NotFoundException("Share link not found");
    }
    this.assertPublicLinkIsUsable(link.revokedAt, link.expiresAt, link.maxViews, link.viewCount);

    const updated = await this.prisma.shareLink.update({
      where: { id: link.id },
      data: {
        viewCount: {
          increment: 1,
        },
        lastAccessedAt: new Date(),
      },
      select: {
        viewCount: true,
        lastAccessedAt: true,
      },
    });

    const canonicalTree = ensureCanonicalTree(
      link.document.canonicalJson as unknown as Parameters<typeof ensureCanonicalTree>[0],
      link.document.schemaVersion,
    );
    const previewHtml = renderCanonicalToPrintHtml({
      documentTitle: link.document.title,
      status: link.document.status,
      generatedAtIso: new Date().toISOString(),
      root: canonicalTree as unknown as Record<string, unknown>,
    });

    await this.auditService.write({
      tenantId: link.tenantId,
      action: "SHARE_LINK_VIEWED",
      objectType: "SHARE_LINK",
      objectId: link.id,
      requestId: meta?.requestId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        documentId: link.documentId,
        permission: link.permission,
      },
      dataClassification: "sensitive_case",
    });

    return {
      shareLink: {
        id: link.id,
        permission: link.permission,
        expiresAt: link.expiresAt,
        maxViews: link.maxViews,
        viewCount: updated.viewCount,
        lastAccessedAt: updated.lastAccessedAt,
      },
      document: {
        id: link.document.id,
        title: link.document.title,
        type: link.document.type,
        status: link.document.status,
        schemaVersion: link.document.schemaVersion,
      },
      previewHtml,
      comments: link.comments,
    };
  }

  async createPublicComment(
    token: string,
    input: CreateShareLinkCommentDto,
    meta?: MutationContext,
  ) {
    const tokenHash = this.hashToken(token);
    const link = await this.prisma.shareLink.findUnique({
      where: {
        tokenHash,
      },
      select: {
        id: true,
        tenantId: true,
        documentId: true,
        permission: true,
        revokedAt: true,
        expiresAt: true,
        maxViews: true,
        viewCount: true,
      },
    });

    if (!link) {
      throw new NotFoundException("Share link not found");
    }

    this.assertPublicLinkIsUsable(link.revokedAt, link.expiresAt, link.maxViews, link.viewCount);

    if (link.permission !== SharePermission.COMMENT) {
      throw new ForbiddenException("Share link does not allow commenting");
    }

    const comment = await this.prisma.shareLinkComment.create({
      data: {
        tenantId: link.tenantId,
        shareLinkId: link.id,
        authorName: input.authorName.trim(),
        body: input.body.trim(),
      },
      select: {
        id: true,
        authorName: true,
        body: true,
        createdAt: true,
      },
    });

    await this.auditService.write({
      tenantId: link.tenantId,
      action: "SHARE_LINK_COMMENTED",
      objectType: "SHARE_LINK",
      objectId: link.id,
      requestId: meta?.requestId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: {
        documentId: link.documentId,
        commentId: comment.id,
      },
      dataClassification: "sensitive_case",
    });

    return comment;
  }

  private async ensureDocument(tenantId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        tenantId,
      },
      select: {
        id: true,
      },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }
  }

  private assertPublicLinkIsUsable(
    revokedAt: Date | null,
    expiresAt: Date,
    maxViews: number | null,
    viewCount: number,
  ): void {
    if (revokedAt) {
      throw new BadRequestException("Share link revoked");
    }
    if (expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Share link expired");
    }
    if (maxViews && viewCount >= maxViews) {
      throw new BadRequestException("Share link view limit reached");
    }
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
