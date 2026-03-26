import { PERMISSIONS } from "@lexoffice/core";
import { prisma } from "@lexoffice/db";
import { Topbar } from "@/components/app/topbar";
import { AdminOperationsPanel } from "@/components/admin/admin-operations-panel";
import { services } from "@/lib/services";
import { getTenantContext } from "@/lib/tenant-context";

export default async function AdminPage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const { tenant, session } = await getTenantContext(tenantSlug);

  await services.rbacService.requirePermission(session.userId, tenant.id, PERMISSIONS.ADMIN_ALL);

  const [memberships, roles, auditLogs, securityLogs] = await Promise.all([
    prisma.membership.findMany({
      where: {
        tenantId: tenant.id,
        deletedAt: null
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        },
        role: {
          select: {
            id: true,
            code: true,
            name: true
          }
        }
      }
    }),
    prisma.role.findMany({
      where: {
        deletedAt: null,
        OR: [{ tenantId: null }, { tenantId: tenant.id }]
      },
      include: {
        permissions: {
          include: {
            permission: {
              select: {
                code: true
              }
            }
          }
        }
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }]
    }),
    prisma.auditLog.findMany({
      where: {
        tenantId: tenant.id
      },
      include: {
        actor: {
          select: {
            email: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 120
    }),
    prisma.securityEvent.findMany({
      where: {
        tenantId: tenant.id
      },
      include: {
        user: {
          select: {
            email: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 120
    })
  ]);

  const combinedLogs = [
    ...auditLogs.map((entry) => ({
      id: entry.id,
      type: "AUDIT" as const,
      actionOrEvent: entry.action,
      severity: null as string | null,
      actor: entry.actor?.email ?? "System",
      createdAt: entry.createdAt
    })),
    ...securityLogs.map((entry) => ({
      id: entry.id,
      type: "SECURITY" as const,
      actionOrEvent: entry.eventType,
      severity: entry.severity,
      actor: entry.user?.email ?? "System",
      createdAt: entry.createdAt
    }))
  ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const errorLogs = combinedLogs.filter((entry) => {
    if (entry.createdAt < sevenDaysAgo) {
      return false;
    }

    if (entry.severity === "HIGH" || entry.severity === "CRITICAL") {
      return true;
    }

    const normalized = entry.actionOrEvent.toLowerCase();
    return (
      normalized.includes("error") ||
      normalized.includes("failed") ||
      normalized.includes("suspicious") ||
      normalized.includes("bruteforce")
    );
  });

  return (
    <>
      <Topbar title="Admin Panel" subtitle="Kullanıcı, rol, yetki ve operasyon logları" />
      <div className="p-4 sm:p-6">
        <AdminOperationsPanel
          tenantId={tenant.id}
          members={memberships.map((entry) => ({
            id: entry.id,
            userId: entry.user.id,
            email: entry.user.email,
            firstName: entry.user.firstName,
            lastName: entry.user.lastName,
            status: entry.status,
            roleCode: entry.role.code,
            roleName: entry.role.name,
            invitedAt: entry.invitedAt ? entry.invitedAt.toISOString() : null,
            joinedAt: entry.joinedAt ? entry.joinedAt.toISOString() : null,
            isCurrentUser: entry.user.id === session.userId
          }))}
          roles={roles.map((role) => ({
            id: role.id,
            code: role.code,
            name: role.name,
            isSystem: role.isSystem,
            permissionCodes: role.permissions.map((item) => item.permission.code).sort()
          }))}
          systemLogs={combinedLogs.slice(0, 150).map((entry) => ({
            id: `${entry.type}:${entry.id}`,
            type: entry.type,
            actionOrEvent: entry.actionOrEvent,
            severity: entry.severity,
            actor: entry.actor,
            createdAt: entry.createdAt.toISOString()
          }))}
          errorLogs={errorLogs.slice(0, 150).map((entry) => ({
            id: `${entry.type}:${entry.id}`,
            type: entry.type,
            actionOrEvent: entry.actionOrEvent,
            severity: entry.severity,
            actor: entry.actor,
            createdAt: entry.createdAt.toISOString()
          }))}
        />
      </div>
    </>
  );
}
