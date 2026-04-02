import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { DocumentStatus, UserRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { assertMatterScope, requestedMatterFromHeaders } from "../policy/matter-scope.policy";
import {
  DOCUMENT_ACCESS_KEY,
  type DocumentPermission,
} from "../decorators/document-access.decorator";
import type { AuthenticatedRequest } from "../types/authenticated-request.type";

@Injectable()
export class DocumentAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<DocumentPermission>(
      DOCUMENT_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!permission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    const tenantId = request.tenantId;
    const rawDocumentId = request.params.id ?? request.params.documentId;
    const documentId =
      typeof rawDocumentId === "string" ? rawDocumentId : undefined;

    if (!user || !tenantId || !documentId) {
      await this.writeDenialAudit(request, tenantId, documentId, "authorization_context_missing");
      throw new ForbiddenException("Authorization context missing");
    }

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        tenantId: true,
        ownerId: true,
        status: true,
        canonicalJson: true,
      },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    if (document.tenantId !== tenantId || user.tenantId !== tenantId) {
      await this.writeDenialAudit(request, tenantId, documentId, "cross_tenant_denied");
      throw new ForbiddenException("Cross-tenant access denied");
    }

    const requestedMatterId = requestedMatterFromHeaders(request.headers as Record<string, unknown>);
    const documentMatterId = this.extractMatterId(document.canonicalJson);
    try {
      assertMatterScope({
        route: request.route?.path ?? "/documents/:id",
        requestedMatterId,
        resourceMatterId: documentMatterId,
      });
    } catch {
      await this.writeDenialAudit(request, tenantId, documentId, "matter_scope_denied");
      throw new ForbiddenException("Matter scope mismatch");
    }

    const allowed = this.evaluatePermission({
      permission,
      role: user.role,
      isOwner: document.ownerId === user.sub,
      status: document.status,
    });

    if (!allowed) {
      await this.writeDenialAudit(request, tenantId, documentId, "object_permission_denied");
      throw new ForbiddenException("Object-level permission denied");
    }

    return true;
  }

  private evaluatePermission(input: {
    permission: DocumentPermission;
    role: UserRole;
    isOwner: boolean;
    status: DocumentStatus;
  }): boolean {
    const { permission, role, isOwner, status } = input;

    if (permission === "view") {
      return [
        "OWNER",
        "ADMIN",
        "EDITOR",
        "REVIEWER",
        "COMMENTER",
        "VIEWER",
      ].includes(role);
    }

    if (permission === "comment") {
      return ["OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER"].includes(
        role,
      );
    }

    if (permission === "edit") {
      if (["FINAL", "ARCHIVED"].includes(status)) {
        return false;
      }
      if (["OWNER", "ADMIN", "EDITOR"].includes(role)) {
        return true;
      }
      return role === "REVIEWER" && isOwner;
    }

    if (permission === "finalize") {
      if (!["DRAFT", "REVIEW"].includes(status)) {
        return false;
      }
      if (["OWNER", "ADMIN"].includes(role)) {
        return true;
      }
      return role === "EDITOR" && isOwner;
    }

    if (permission === "status") {
      if (["OWNER", "ADMIN"].includes(role)) {
        return true;
      }
      if (role === "EDITOR") {
        return !["FINAL", "ARCHIVED"].includes(status);
      }
      return false;
    }

    return false;
  }

  private header(request: AuthenticatedRequest, key: string): string | undefined {
    const value = request.headers[key];
    return typeof value === "string" ? value.trim() || undefined : undefined;
  }

  private extractMatterId(canonicalJson: unknown): string | undefined {
    if (!canonicalJson || typeof canonicalJson !== "object" || Array.isArray(canonicalJson)) {
      return undefined;
    }

    const payload = canonicalJson as Record<string, unknown>;
    const directMatterId =
      payload.matterId ?? payload.matter_id ?? payload.caseId ?? payload.case_id;
    if (typeof directMatterId === "string") {
      const normalized = directMatterId.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }

    const content = payload.content;
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      return undefined;
    }

    const contentRecord = content as Record<string, unknown>;
    const nestedMatterId =
      contentRecord.matterId ??
      contentRecord.matter_id ??
      contentRecord.caseId ??
      contentRecord.case_id;
    if (typeof nestedMatterId !== "string") {
      return undefined;
    }
    const normalizedNested = nestedMatterId.trim();
    return normalizedNested.length > 0 ? normalizedNested : undefined;
  }

  private async writeDenialAudit(
    request: AuthenticatedRequest,
    tenantId: string | undefined,
    documentId: string | undefined,
    reason: string,
  ): Promise<void> {
    if (!tenantId) {
      return;
    }
    await this.auditService.write({
      tenantId,
      actorUserId: request.user?.sub,
      action: "AUTH_LOGIN_FAILED",
      objectType: "AUTH",
      objectId: documentId,
      requestId: this.header(request, "x-request-id"),
      ipAddress: request.ip,
      userAgent: this.header(request, "user-agent"),
      metadata: {
        event: "document_access_denied",
        reason,
      },
      dataClassification: "security",
    });
  }
}
