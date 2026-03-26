import { prisma } from "@lexoffice/db";
import { PERMISSIONS } from "@lexoffice/core";
import { Topbar } from "@/components/app/topbar";
import { services } from "@/lib/services";
import { getTenantContext } from "@/lib/tenant-context";

export default async function AIWorkspacePage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const { tenant, session } = await getTenantContext(tenantSlug);
  await services.rbacService.requirePermission(session.userId, tenant.id, PERMISSIONS.AI_WORKSPACE);

  const latestMessages = await prisma.aIMessage.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      promptTemplateKey: true,
      content: true,
      accepted: true,
      createdAt: true
    }
  });

  return (
    <>
      <Topbar title="AI Workspace" subtitle="Öneriler, kullanım ve geri bildirimler" />
      <div className="p-4 sm:p-6">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {latestMessages.length === 0 ? (
            <p className="text-sm text-slate-600">Henüz AI işlem kaydı yok.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {latestMessages.map((message) => (
                <li key={message.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-xs text-slate-500">{message.promptTemplateKey ?? "UNKNOWN"}</p>
                  <p className="mt-1 line-clamp-3 text-slate-700">{message.content}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(message.createdAt).toLocaleString("tr-TR")}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
