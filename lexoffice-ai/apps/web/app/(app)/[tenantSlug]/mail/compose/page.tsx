import { notFound } from "next/navigation";
import { prisma } from "@lexoffice/db";
import { Topbar } from "@/components/app/topbar";
import { ComposeEditor } from "@/components/mail/compose-editor";
import { getTenantContext } from "@/lib/tenant-context";

export default async function ComposePage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const { tenant } = await getTenantContext(tenantSlug);

  const mailbox = await prisma.mailbox.findFirst({
    where: {
      tenantId: tenant.id,
      deletedAt: null
    },
    orderBy: { createdAt: "asc" }
  });

  if (!mailbox) {
    notFound();
  }

  return (
    <>
      <Topbar title="Compose" subtitle={`Gönderen: ${mailbox.email}`} />
      <div className="p-4 sm:p-6">
        <ComposeEditor tenantId={tenant.id} mailboxId={mailbox.id} />
      </div>
    </>
  );
}
