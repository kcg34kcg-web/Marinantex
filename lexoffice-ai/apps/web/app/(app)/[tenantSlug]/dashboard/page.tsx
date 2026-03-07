import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@lexoffice/db";
import { Topbar } from "@/components/app/topbar";

export default async function TenantDashboardPage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    include: {
      settings: true,
      _count: {
        select: {
          memberships: true,
          mailboxes: true,
          domains: true,
          matters: true,
          tasks: true
        }
      }
    }
  });

  if (!tenant || tenant.deletedAt) {
    notFound();
  }

  return (
    <>
      <Topbar title={tenant.name} subtitle={tenant.slug} />
      <main className="p-4 sm:p-6">
        <div className="mb-6 flex items-center justify-end">
          <Link className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700" href="/create-office">
            Yeni Ofis
          </Link>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard label="Üye" value={tenant._count.memberships} />
          <KpiCard label="Mailbox" value={tenant._count.mailboxes} />
          <KpiCard label="Domain" value={tenant._count.domains} />
          <KpiCard label="Matter" value={tenant._count.matters} />
          <KpiCard label="Task" value={tenant._count.tasks} />
        </section>
      </main>
    </>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
    </article>
  );
}
