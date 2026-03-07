import { notFound } from "next/navigation";
import { prisma } from "@lexoffice/db";
import { Topbar } from "@/components/app/topbar";
import { MailThreadView } from "@/components/mail/mail-thread-view";
import { getTenantContext } from "@/lib/tenant-context";

export default async function MailThreadDetailPage({
  params
}: {
  params: Promise<{ tenantSlug: string; threadId: string }>;
}) {
  const { tenantSlug, threadId } = await params;
  const { tenant } = await getTenantContext(tenantSlug);

  const thread = await prisma.mailThread.findFirst({
    where: {
      id: threadId,
      tenantId: tenant.id,
      deletedAt: null
    },
    include: {
      matter: {
        select: {
          id: true,
          title: true,
          referenceNo: true
        }
      },
      messages: {
        where: { deletedAt: null },
        orderBy: [{ receivedAt: "asc" }, { sentAt: "asc" }],
        select: {
          id: true,
          fromEmail: true,
          fromName: true,
          subject: true,
          bodyText: true,
          snippet: true,
          isRead: true,
          receivedAt: true
        }
      }
    }
  });

  if (!thread) {
    notFound();
  }

  return (
    <>
      <Topbar title="Mail Detay" subtitle={thread.subject ?? "(Konu yok)"} />
      <div className="p-4 sm:p-6">
        <MailThreadView tenantId={tenant.id} thread={thread} />
      </div>
    </>
  );
}
