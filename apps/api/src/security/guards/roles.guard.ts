import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuditService } from "../../audit/audit.service";
import type { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../decorators/roles.decorator";
import type { AuthenticatedRequest } from "../types/authenticated-request.type";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;
    if (!role) {
      void this.writeDenialAudit(request, "role_missing", requiredRoles);
      throw new ForbiddenException("Role context missing");
    }

    if (!requiredRoles.includes(role)) {
      void this.writeDenialAudit(request, "insufficient_role", requiredRoles);
      throw new ForbiddenException("Insufficient role");
    }

    return true;
  }

  private async writeDenialAudit(
    request: AuthenticatedRequest,
    reason: string,
    requiredRoles: UserRole[],
  ): Promise<void> {
    const tenantId = request.tenantId;
    if (!tenantId) {
      return;
    }
    const requestIdHeader = request.headers["x-request-id"];
    const userAgentHeader = request.headers["user-agent"];
    await this.auditService.write({
      tenantId,
      actorUserId: request.user?.sub,
      action: "AUTH_LOGIN_FAILED",
      objectType: "AUTH",
      requestId: typeof requestIdHeader === "string" ? requestIdHeader : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgentHeader === "string" ? userAgentHeader : undefined,
      metadata: {
        event: "role_guard_denied",
        reason,
        requiredRoles,
        actualRole: request.user?.role,
      },
      dataClassification: "security",
    });
  }
}
