import type { PrismaClient } from "@lexoffice/db";
import {
  disableMfaSchema,
  loginSchema,
  revokeSessionSchema,
  startMfaEnrollmentSchema,
  verifyMfaEnrollmentSchema,
  type LoginInput
} from "@lexoffice/contracts";
import { AuditService } from "../audit/audit-service";
import { AppError, NotFoundError, UnauthorizedError } from "../errors/app-error";
import { decryptSecret, encryptSecret } from "../security/secret-crypto";
import { verifyPassword } from "../security/password";
import { SecurityEventService } from "../security/security-event-service";
import { generateSessionToken, sha256 } from "../security/token";
import { buildOtpAuthUri, generateTotpSecret, verifyTotpCode } from "../security/mfa-totp";
import { signPayloadToken, verifyPayloadToken } from "../security/signed-token";

const SESSION_TTL_DAYS = 30;

type AuthRequestMeta = {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
};

type MfaEnrollmentTokenPayload = {
  userId: string;
  tenantId: string;
  secret: string;
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

    const mfaRequired = user.mfaEnabled;
    if (mfaRequired) {
      if (!input.mfaCode) {
        throw new AppError("MFA_REQUIRED", "MFA kodu gerekli", 401, {
          mfaRequired: true
        });
      }

      if (!user.mfaSecretEncrypted) {
        throw new UnauthorizedError("MFA yapılandırması eksik. Güvenlik yöneticisine başvurun");
      }

      const decryptedSecret = decryptSecret(user.mfaSecretEncrypted);
      const verified = verifyTotpCode({
        secret: decryptedSecret,
        code: input.mfaCode
      });

      if (!verified) {
        await this.securityEventService?.record({
          tenantId: membership.tenantId,
          userId: user.id,
          eventType: "auth.login.mfa_failed",
          severity: "MEDIUM",
          description: "Geçersiz MFA kodu",
          ...(meta?.ipAddress === undefined ? {} : { ipAddress: meta.ipAddress }),
          ...(meta?.userAgent === undefined ? {} : { userAgent: meta.userAgent })
        });

        throw new UnauthorizedError("MFA kodu geçersiz");
      }
    }

    const suspiciousSignals = await this.captureSuspiciousLoginSignals(
      user.id,
      membership.tenantId,
      normalizedEmail,
      meta
    );

    const token = generateSessionToken();
    const sessionTokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        tenantId: membership.tenantId,
        sessionTokenHash,
        expiresAt,
        ...(meta?.ipAddress === undefined ? {} : { ipAddress: meta.ipAddress }),
        ...(meta?.userAgent === undefined ? {} : { userAgent: meta.userAgent }),
        ...(meta?.userAgent === undefined ? {} : { deviceName: inferDeviceName(meta.userAgent) }),
        ...(mfaRequired ? { mfaVerifiedAt: new Date() } : {})
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
      ...(meta?.requestId === undefined ? {} : { requestId: meta.requestId }),
      metadata: {
        mfaRequired,
        mfaVerifiedAt: session.mfaVerifiedAt,
        suspiciousSignals
      }
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
        sessionId: session.id,
        mfaVerified: Boolean(session.mfaVerifiedAt),
        suspiciousSignals
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
        lastName: user.lastName,
        mfaEnabled: user.mfaEnabled
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

    if (session.user.mfaEnabled && !session.mfaVerifiedAt) {
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

  async startMfaEnrollment(actorUserId: string, payload: unknown) {
    const input = startMfaEnrollmentSchema.parse(payload);
    await this.assertTenantMembership(actorUserId, input.tenantId);

    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: {
        id: true,
        email: true,
        mfaEnabled: true
      }
    });

    if (!user) {
      throw new NotFoundError("Kullanıcı bulunamadı");
    }

    if (user.mfaEnabled) {
      throw new AppError("MFA_ALREADY_ENABLED", "MFA zaten aktif", 409);
    }

    const secret = generateTotpSecret();
    const enrollmentToken = signPayloadToken({
      subject: "auth:mfa:enrollment",
      payload: {
        userId: actorUserId,
        tenantId: input.tenantId,
        secret
      },
      ttlSeconds: 10 * 60
    });

    const issuer = process.env.MFA_ISSUER?.trim() || "LexOffice AI";
    const otpauthUrl = buildOtpAuthUri({
      issuer,
      accountName: user.email,
      secret
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "auth.mfa.enrollment.started",
      resourceType: "user",
      resourceId: actorUserId
    });

    return {
      enrollmentToken,
      secret,
      otpauthUrl,
      issuer,
      accountName: user.email
    };
  }

  async verifyMfaEnrollment(actorUserId: string, payload: unknown) {
    const input = verifyMfaEnrollmentSchema.parse(payload);
    await this.assertTenantMembership(actorUserId, input.tenantId);

    const tokenPayload = verifyPayloadToken<MfaEnrollmentTokenPayload>({
      token: input.enrollmentToken,
      subject: "auth:mfa:enrollment"
    });

    if (tokenPayload.userId !== actorUserId || tokenPayload.tenantId !== input.tenantId) {
      throw new UnauthorizedError("MFA enrollment token bağlamı geçersiz");
    }

    const verified = verifyTotpCode({
      secret: tokenPayload.secret,
      code: input.code
    });

    if (!verified) {
      throw new UnauthorizedError("MFA doğrulama kodu geçersiz");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: actorUserId },
        data: {
          mfaEnabled: true,
          mfaSecretEncrypted: encryptSecret(tokenPayload.secret)
        }
      });

      await tx.userSession.updateMany({
        where: {
          userId: actorUserId,
          tenantId: input.tenantId,
          revokedAt: null,
          expiresAt: {
            gt: new Date()
          }
        },
        data: {
          mfaVerifiedAt: new Date()
        }
      });
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "auth.mfa.enabled",
      resourceType: "user",
      resourceId: actorUserId
    });

    await this.securityEventService?.record({
      tenantId: input.tenantId,
      userId: actorUserId,
      eventType: "auth.mfa.enabled",
      severity: "MEDIUM",
      description: "Kullanıcı MFA etkinleştirdi"
    });

    return {
      mfaEnabled: true
    };
  }

  async disableMfa(actorUserId: string, payload: unknown) {
    const input = disableMfaSchema.parse(payload);
    await this.assertTenantMembership(actorUserId, input.tenantId);

    const user = await this.prisma.user.findUnique({
      where: {
        id: actorUserId
      },
      select: {
        id: true,
        mfaEnabled: true,
        mfaSecretEncrypted: true
      }
    });

    if (!user || !user.mfaEnabled || !user.mfaSecretEncrypted) {
      throw new AppError("MFA_NOT_ENABLED", "MFA zaten kapalı", 409);
    }

    const verified = verifyTotpCode({
      secret: decryptSecret(user.mfaSecretEncrypted),
      code: input.code
    });

    if (!verified) {
      throw new UnauthorizedError("MFA doğrulama kodu geçersiz");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: {
          id: actorUserId
        },
        data: {
          mfaEnabled: false,
          mfaSecretEncrypted: null
        }
      });

      await tx.userSession.updateMany({
        where: {
          userId: actorUserId,
          tenantId: input.tenantId,
          revokedAt: null
        },
        data: {
          mfaVerifiedAt: null
        }
      });
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "auth.mfa.disabled",
      resourceType: "user",
      resourceId: actorUserId
    });

    await this.securityEventService?.record({
      tenantId: input.tenantId,
      userId: actorUserId,
      eventType: "auth.mfa.disabled",
      severity: "HIGH",
      description: "Kullanıcı MFA devre dışı bıraktı"
    });

    return {
      mfaEnabled: false
    };
  }

  async listSessions(actorUserId: string, tenantId: string, currentSessionId: string) {
    await this.assertTenantMembership(actorUserId, tenantId);

    const sessions = await this.prisma.userSession.findMany({
      where: {
        userId: actorUserId,
        tenantId,
        expiresAt: {
          gt: new Date()
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true,
        deviceName: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        mfaVerifiedAt: true
      }
    });

    return sessions.map((session) => ({
      ...session,
      isCurrent: session.id === currentSessionId
    }));
  }

  async revokeSession(actorUserId: string, tenantId: string, payload: unknown) {
    const input = revokeSessionSchema.parse(payload);
    await this.assertTenantMembership(actorUserId, tenantId);

    const session = await this.prisma.userSession.findFirst({
      where: {
        id: input.sessionId,
        userId: actorUserId,
        tenantId
      },
      select: {
        id: true,
        revokedAt: true
      }
    });

    if (!session) {
      throw new NotFoundError("Session bulunamadı");
    }

    if (!session.revokedAt) {
      await this.prisma.userSession.update({
        where: {
          id: session.id
        },
        data: {
          revokedAt: new Date()
        }
      });
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      action: "auth.session.revoked",
      resourceType: "user_session",
      resourceId: session.id
    });

    return {
      revoked: true,
      sessionId: session.id
    };
  }

  async revokeOtherSessions(actorUserId: string, tenantId: string, currentSessionId: string) {
    await this.assertTenantMembership(actorUserId, tenantId);

    const result = await this.prisma.userSession.updateMany({
      where: {
        userId: actorUserId,
        tenantId,
        revokedAt: null,
        id: {
          not: currentSessionId
        }
      },
      data: {
        revokedAt: new Date()
      }
    });

    await this.auditService.log({
      tenantId,
      actorUserId,
      action: "auth.session.revoked_others",
      resourceType: "user_session",
      metadata: {
        revokedCount: result.count
      }
    });

    return {
      revokedCount: result.count
    };
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

  private async assertTenantMembership(userId: string, tenantId: string): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        tenantId,
        status: "ACTIVE",
        deletedAt: null
      },
      select: {
        id: true
      }
    });

    if (!membership) {
      throw new UnauthorizedError("Tenant üyeliği bulunamadı");
    }
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

    if (userId) {
      const windowStart = new Date(Date.now() - 10 * 60 * 1000);
      const recentFailures = await this.prisma.securityEvent.count({
        where: {
          tenantId: tenant.id,
          userId,
          eventType: "auth.login.failed",
          createdAt: {
            gte: windowStart
          }
        }
      });

      if (recentFailures >= 5) {
        await this.securityEventService.record({
          tenantId: tenant.id,
          userId,
          eventType: "auth.login.bruteforce_suspected",
          severity: recentFailures >= 8 ? "HIGH" : "MEDIUM",
          description: "Kısa sürede çok sayıda başarısız giriş denemesi tespit edildi",
          ...(meta?.ipAddress === undefined ? {} : { ipAddress: meta.ipAddress }),
          ...(meta?.userAgent === undefined ? {} : { userAgent: meta.userAgent }),
          payload: {
            normalizedEmail,
            recentFailures,
            windowMinutes: 10
          }
        });
      }
    }
  }

  private async captureSuspiciousLoginSignals(
    userId: string,
    tenantId: string,
    normalizedEmail: string,
    meta?: AuthRequestMeta
  ): Promise<{
    recentFailureCount: number;
    newIpAddress: boolean;
  }> {
    const failureWindowStart = new Date(Date.now() - 15 * 60 * 1000);
    const recentFailureCount = await this.prisma.securityEvent.count({
      where: {
        tenantId,
        userId,
        eventType: "auth.login.failed",
        createdAt: {
          gte: failureWindowStart
        }
      }
    });

    const sessions = await this.prisma.userSession.findMany({
      where: {
        userId,
        tenantId,
        revokedAt: null,
        ipAddress: {
          not: null
        },
        createdAt: {
          gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        }
      },
      select: {
        ipAddress: true
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 25
    });

    const knownIps = new Set(
      sessions
        .map((session) => session.ipAddress?.trim())
        .filter((ip): ip is string => Boolean(ip && ip.length > 0))
    );
    const requestIp = meta?.ipAddress?.trim();
    const newIpAddress = Boolean(requestIp && knownIps.size > 0 && !knownIps.has(requestIp));

    if (this.securityEventService && (recentFailureCount >= 5 || newIpAddress)) {
      await this.securityEventService.record({
        tenantId,
        userId,
        eventType: "auth.login.suspicious",
        severity: recentFailureCount >= 8 ? "HIGH" : "MEDIUM",
        description: "Şüpheli giriş sinyali tespit edildi",
        ...(meta?.ipAddress === undefined ? {} : { ipAddress: meta.ipAddress }),
        ...(meta?.userAgent === undefined ? {} : { userAgent: meta.userAgent }),
        payload: {
          normalizedEmail,
          recentFailureCount,
          newIpAddress,
          knownIpCount: knownIps.size
        }
      });
    }

    return {
      recentFailureCount,
      newIpAddress
    };
  }
}

function inferDeviceName(userAgent: string): string {
  const lower = userAgent.toLowerCase();

  if (lower.includes("iphone") || lower.includes("ios")) {
    return "iPhone";
  }

  if (lower.includes("android")) {
    return "Android";
  }

  if (lower.includes("macintosh") || lower.includes("mac os")) {
    return "Mac";
  }

  if (lower.includes("windows")) {
    return "Windows";
  }

  if (lower.includes("linux")) {
    return "Linux";
  }

  return "Unknown Device";
}
