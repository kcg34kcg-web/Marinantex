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
      throw new ForbiddenException("Authorization context missing");
    }

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        tenantId: true,
        ownerId: true,
        status: true,
      },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    if (document.tenantId !== tenantId || user.tenantId !== tenantId) {
      throw new ForbiddenException("Cross-tenant access denied");
    }

    const allowed = this.evaluatePermission({
      permission,
      role: user.role,
      isOwner: document.ownerId === user.sub,
      status: document.status,
    });

    if (!allowed) {
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
}
