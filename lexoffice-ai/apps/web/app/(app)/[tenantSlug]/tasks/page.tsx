import { prisma } from "@lexoffice/db";
import { PERMISSIONS } from "@lexoffice/core";
import { Topbar } from "@/components/app/topbar";
import { TaskCreateForm } from "@/components/crm/task-create-form";
import { services } from "@/lib/services";
import { getTenantContext } from "@/lib/tenant-context";

export default async function TasksPage({
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

  const tasks = await prisma.task.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: 30
  });
  const matters = await prisma.matter.findMany({
    where: {
      tenantId: tenant.id,
      deletedAt: null
    },
    orderBy: {
      createdAt: "desc"
    },
    select: {
      id: true,
      title: true
    },
    take: 100
  });

  return (
    <>
      <Topbar title="Tasks" subtitle="Mail ve matter kaynaklı görevler" />
      <div className="space-y-4 p-4 sm:p-6">
        <TaskCreateForm tenantId={tenant.id} matters={matters} />
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {tasks.length === 0 ? (
            <p className="text-sm text-slate-600">Henüz task kaydı yok.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {tasks.map((task) => (
                <li key={task.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="font-medium text-slate-900">{task.title}</p>
                  <p className="text-xs text-slate-500">{task.status} / {task.priority}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
