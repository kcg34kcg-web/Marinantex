import type { PrismaClient } from "@lexoffice/db";
import { loginSchema, type LoginInput } from "@lexoffice/contracts";
import { UnauthorizedError } from "../errors/app-error";
import { verifyPassword } from "../security/password";
import { generateSessionToken, sha256 } from "../security/token";
import { AuditService } from "../audit/audit-service";
import { SecurityEventService } from "../security/security-event-service";

const SESSION_TTL_DAYS = 30;

type AuthRequestMeta = {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
};

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly securityEventService?: SecurityEventService
  ) {}

  async login(payload: LoginInput, meta?: AuthRequestMeta) {
    const input = loginSchema.parse(payload);
    const normalizedEmail = input.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: {
        normalizedEmail
      }
    });

    if (!user || !user.passwordHash || !user.active || user.deletedAt) {
      await this.logFailedAttempt(normalizedEmail, input.tenantSlug, meta);
      throw new UnauthorizedError("Geçersiz kimlik bilgileri");
    }

    const passwordOk = await verifyPassword(input.password, user.passwordHash);
    if (!passwordOk) {
      await this.logFailedAttempt(normalizedEmail, input.tenantSlug, meta, user.id);
      throw new UnauthorizedError("Geçersiz kimlik bilgileri");
    }

    const membership = await this.resolveMembership(user.id, input.tenantSlug);
    if (!membership) {
      await this.logFailedAttempt(normalizedEmail, input.tenantSlug, meta, user.id);
      throw new UnauthorizedError("Aktif tenant üyeliği bulunamadı");
    }

    const token = generateSessionToken();
    const sessionTokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        tenantId: membership.tenantId,
        sessionTokenHash,
        expiresAt
      }
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date()
      }
    });

    await this.auditService.log({
      tenantId: membership.tenantId,
      actorUserId: user.id,
      action: "auth.login",
      resourceType: "user_session",
      resourceId: session.id,
      ...(meta?.ipAddress === undefined ? {} : { ipAddress: meta.ipAddress }),
      ...(meta?.userAgent === undefined ? {} : { userAgent: meta.userAgent }),
      ...(meta?.requestId === undefined ? {} : { requestId: meta.requestId })
    });

    await this.securityEventService?.record({
      tenantId: membership.tenantId,
      userId: user.id,
      eventType: "auth.login.success",
      severity: "LOW",
      description: "Kullanıcı başarıyla giriş yaptı",
      ...(meta?.ipAddress === undefined ? {} : { ipAddress: meta.ipAddress }),
      ...(meta?.userAgent === undefined ? {} : { userAgent: meta.userAgent }),
      payload: {
        sessionId: session.id
      }
    });

    return {
      token,
      sessionId: session.id,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      },
      tenant: {
        id: membership.tenantId,
        slug: membership.tenant.slug,
        name: membership.tenant.name
      },
      role: {
        code: membership.role.code,
        name: membership.role.name
      }
    };
  }

  async validateSession(sessionToken: string) {
    const hashed = sha256(sessionToken);

    const session = await this.prisma.userSession.findUnique({
      where: { sessionTokenHash: hashed },
      include: {
        user: true
      }
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      return null;
    }

    return session;
  }

  async logout(sessionToken: string, meta?: AuthRequestMeta): Promise<void> {
    const hashed = sha256(sessionToken);

    const session = await this.prisma.userSession.findUnique({
      where: { sessionTokenHash: hashed },
      select: {
        id: true,
        userId: true,
        tenantId: true,
        revokedAt: true
      }
    });

    await this.prisma.userSession.updateMany({
      where: {
        sessionTokenHash: hashed,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    if (!session || session.revokedAt || !session.tenantId) {
      return;
    }

    await this.auditService.log({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "auth.logout",
      resourceType: "user_session",
      resourceId: session.id,
      ...(meta?.ipAddress === undefined ? {} : { ipAddress: meta.ipAddress }),
      ...(meta?.userAgent === undefined ? {} : { userAgent: meta.userAgent }),
      ...(meta?.requestId === undefined ? {} : { requestId: meta.requestId })
    });

    await this.securityEventService?.record({
      tenantId: session.tenantId,
      userId: session.userId,
      eventType: "auth.logout",
      severity: "LOW",
      description: "Kullanıcı oturumu kapattı",
      ...(meta?.ipAddress === undefined ? {} : { ipAddress: meta.ipAddress }),
      ...(meta?.userAgent === undefined ? {} : { userAgent: meta.userAgent })
    });
  }

  private async resolveMembership(userId: string, tenantSlug?: string) {
    return this.prisma.membership.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        deletedAt: null,
        tenant: {
          deletedAt: null,
          ...(tenantSlug ? { slug: tenantSlug } : {})
        }
      },
      include: {
        tenant: true,
        role: true
      },
      orderBy: {
        joinedAt: "asc"
      }
    });
  }

  private async logFailedAttempt(
    normalizedEmail: string,
    tenantSlug: string | undefined,
    meta?: AuthRequestMeta,
    userId?: string
  ): Promise<void> {
    if (!this.securityEventService) {
      return;
    }

    const tenant = tenantSlug
      ? await this.prisma.tenant.findFirst({
          where: {
            slug: tenantSlug,
            deletedAt: null
          },
          select: { id: true }
        })
      : null;

    if (!tenant) {
      return;
    }

    await this.securityEventService.record({
      tenantId: tenant.id,
      ...(userId === undefined ? {} : { userId }),
      eventType: "auth.login.failed",
      severity: "MEDIUM",
      description: "Başarısız giriş denemesi",
      ...(meta?.ipAddress === undefined ? {} : { ipAddress: meta.ipAddress }),
      ...(meta?.userAgent === undefined ? {} : { userAgent: meta.userAgent }),
      payload: {
        normalizedEmail
      }
    });
  }
}
