import { prisma } from "@lexoffice/db";
import { PERMISSIONS } from "@lexoffice/core";
import { Topbar } from "@/components/app/topbar";
import { ClientCreateForm } from "@/components/crm/client-create-form";
import { ContactManagementPanel } from "@/components/crm/contact-management-panel";
import { services } from "@/lib/services";
import { getTenantContext } from "@/lib/tenant-context";

export default async function ClientsPage({
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

  const clients = await prisma.client.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 20
  });
  const contacts = await prisma.contact.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 100
  });

  return (
    <>
      <Topbar title="Clients" subtitle="Müvekkil yönetimi" />
      <div className="space-y-4 p-4 sm:p-6">
        <ContactManagementPanel
          tenantId={tenant.id}
          contacts={contacts.map((contact) => ({
            id: contact.id,
            fullName: contact.fullName,
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            phone: contact.phone,
            company: contact.company,
            title: contact.title,
            notes: contact.notes,
            updatedAt: contact.updatedAt.toISOString()
          }))}
        />
        <ClientCreateForm tenantId={tenant.id} />
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
