import { prisma } from "@lexoffice/db";
import { Topbar } from "@/components/app/topbar";
import { getTenantContext } from "@/lib/tenant-context";

export default async function ClientsPage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const { tenant } = await getTenantContext(tenantSlug);

  const clients = await prisma.client.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 20
  });

  return (
    <>
      <Topbar title="Clients" subtitle="Müvekkil yönetimi" />
      <div className="p-4 sm:p-6">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {clients.length === 0 ? (
            <p className="text-sm text-slate-600">Henüz client kaydı bulunmuyor.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {clients.map((client) => (
                <li key={client.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  {client.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
