import { prisma } from "@lexoffice/db";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session.tenantId) {
      return ok({ generatedAt: new Date().toISOString(), scope: "none", data: {} });
    }

    const [user, sessions, memberships, auditLogs, securityEvents] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: {
          id: session.userId
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          locale: true,
          active: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
          mfaEnabled: true
        }
      }),
      prisma.userSession.findMany({
        where: {
          userId: session.userId,
          tenantId: session.tenantId
        },
        orderBy: {
          createdAt: "desc"
        },
        select: {
          id: true,
          ipAddress: true,
          deviceName: true,
          userAgent: true,
          mfaVerifiedAt: true,
          createdAt: true,
          expiresAt: true,
          revokedAt: true
        }
      }),
      prisma.membership.findMany({
        where: {
          userId: session.userId
        },
        include: {
          tenant: {
            select: {
              id: true,
              slug: true,
              name: true
            }
          },
          role: {
            select: {
              code: true,
              name: true
            }
          }
        }
      }),
      prisma.auditLog.findMany({
        where: {
          tenantId: session.tenantId,
          actorUserId: session.userId
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1000,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          metadata: true,
          ipAddress: true,
          userAgent: true,
          requestId: true,
          createdAt: true
        }
      }),
      prisma.securityEvent.findMany({
        where: {
          tenantId: session.tenantId,
          userId: session.userId
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1000,
        select: {
          id: true,
          eventType: true,
          severity: true,
          description: true,
          ipAddress: true,
          userAgent: true,
          payload: true,
          createdAt: true
        }
      })
    ]);

    await services.securityEventService.record({
      tenantId: session.tenantId,
      userId: session.userId,
      eventType: "privacy.export.generated",
      severity: "LOW",
      description: "Kullanıcı kişisel veri dışa aktarımı oluşturdu",
      payload: {
        auditLogCount: auditLogs.length,
        securityEventCount: securityEvents.length
      }
    });

    return ok({
      generatedAt: new Date().toISOString(),
      scope: "self",
      tenantId: session.tenantId,
      user,
      sessions: sessions.map((entry) => ({
        ...entry,
        mfaVerifiedAt: entry.mfaVerifiedAt?.toISOString() ?? null,
        createdAt: entry.createdAt.toISOString(),
        expiresAt: entry.expiresAt.toISOString(),
        revokedAt: entry.revokedAt?.toISOString() ?? null
      })),
      memberships: memberships.map((entry) => ({
        id: entry.id,
        status: entry.status,
        invitedAt: entry.invitedAt?.toISOString() ?? null,
        joinedAt: entry.joinedAt?.toISOString() ?? null,
        tenant: entry.tenant,
        role: entry.role
      })),
      auditLogs: auditLogs.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString()
      })),
      securityEvents: securityEvents.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString()
      }))
    });
  } catch (error) {
    return fail(error);
  }
}
