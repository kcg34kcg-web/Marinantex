import { prisma } from "@lexoffice/db";
import { PERMISSIONS } from "@lexoffice/core";
import { Topbar } from "@/components/app/topbar";
import { AuditTable } from "@/components/admin/audit-table";
import { services } from "@/lib/services";
import { getTenantContext } from "@/lib/tenant-context";

export default async function AuditPage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const { tenant, session } = await getTenantContext(tenantSlug);
  await services.rbacService.requirePermission(session.userId, tenant.id, PERMISSIONS.AUDIT_VIEW);

  const logs = await prisma.auditLog.findMany({
    where: {
      tenantId: tenant.id
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 100,
    select: {
      id: true,
      action: true,
      resourceType: true,
      createdAt: true
    }
  });

  return (
    <>
      <Topbar title="Audit Logs" subtitle="Kritik işlemler ve güvenlik izleri" />
      <div className="p-4 sm:p-6">
        <AuditTable
          rows={logs.map((log) => ({
            id: log.id,
            action: log.action,
            resourceType: log.resourceType,
            createdAt: log.createdAt.toISOString()
          }))}
        />
      </div>
    </>
  );
}
