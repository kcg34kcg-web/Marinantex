import { prisma } from "@lexoffice/db";
import { PERMISSIONS } from "@lexoffice/core";
import { Topbar } from "@/components/app/topbar";
import { MatterCreateForm } from "@/components/crm/matter-create-form";
import { services } from "@/lib/services";
import { getTenantContext } from "@/lib/tenant-context";

export default async function MattersPage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const { tenant, session } = await getTenantContext(tenantSlug);
  await services.rbacService.requirePermission(
    session.userId,
    tenant.id,
    PERMISSIONS.CLIENT_MATTER_ACCESS
  );

  const matters = await prisma.matter.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    include: {
      client: {
        select: {
          name: true
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 20
  });
  const clients = await prisma.client.findMany({
    where: {
      tenantId: tenant.id,
      deletedAt: null
    },
    orderBy: {
      name: "asc"
    },
    select: {
      id: true,
      name: true
    },
    take: 100
  });

  return (
    <>
      <Topbar title="Matters" subtitle="Dosya ve iş takibi" />
      <div className="space-y-4 p-4 sm:p-6">
        <MatterCreateForm tenantId={tenant.id} clients={clients} />
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {matters.length === 0 ? (
            <p className="text-sm text-slate-600">Henüz matter kaydı bulunmuyor.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {matters.map((matter) => (
                <li key={matter.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="font-medium text-slate-900">{matter.title}</p>
                  <p className="text-xs text-slate-500">{matter.client.name}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
