import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { JwtPayload } from "../../auth/types/jwt-payload.type";
import type { AuthenticatedRequest } from "../types/authenticated-request.type";
import { ACCESS_TOKEN_COOKIE, readCookie } from "../utils/cookies";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  private async verifyToken(token: string): Promise<JwtPayload | null> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      return null;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;
    const tokenFromHeader = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : undefined;
    const tokenFromCookie = readCookie(
      request.headers.cookie,
      ACCESS_TOKEN_COOKIE,
    );
    if (!tokenFromHeader && !tokenFromCookie) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const payloadFromHeader = tokenFromHeader
      ? await this.verifyToken(tokenFromHeader)
      : null;
    const payloadFromCookie = tokenFromCookie
      ? await this.verifyToken(tokenFromCookie)
      : null;
    let payload = payloadFromHeader || payloadFromCookie;
    if (request.tenantId) {
      if (payloadFromHeader?.tenantId === request.tenantId) {
        payload = payloadFromHeader;
      } else if (payloadFromCookie?.tenantId === request.tenantId) {
        payload = payloadFromCookie;
      }
    }
    if (!payload) {
      throw new UnauthorizedException("Invalid token");
    }

    if (request.tenantId && payload.tenantId !== request.tenantId) {
      throw new ForbiddenException("Tenant mismatch");
    }

    request.user = payload;
    return true;
  }
}
