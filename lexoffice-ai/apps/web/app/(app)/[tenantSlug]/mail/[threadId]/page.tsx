import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@lexoffice/db";
import { PERMISSIONS } from "@lexoffice/core";
import { MailThreadView } from "@/components/mail/mail-thread-view";
import { withBasePath } from "@/lib/base-path";
import { services } from "@/lib/services";
import { getTenantContext } from "@/lib/tenant-context";

export default async function MailThreadDetailPage({
  params
}: {
  params: Promise<{ tenantSlug: string; threadId: string }>;
}) {
  const { tenantSlug, threadId } = await params;
  const { tenant, session } = await getTenantContext(tenantSlug);
  await services.rbacService.requirePermission(session.userId, tenant.id, PERMISSIONS.MAILBOX_VIEW);

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
          internetMessageId: true,
          fromEmail: true,
          fromName: true,
          subject: true,
          direction: true,
          state: true,
          bodyText: true,
          bodyHtml: true,
          snippet: true,
          isRead: true,
          sentAt: true,
          receivedAt: true,
          recipients: {
            select: {
              id: true,
              type: true,
              name: true,
              email: true
            }
          },
          attachments: {
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              sizeBytes: true,
              virusScanStatus: true
            }
          }
        }
      }
    }
  });

  if (!thread) {
    notFound();
  }

  const hydratedMessages = await Promise.all(
    thread.messages.map(async (message) => {
      const attachments = await Promise.all(
        message.attachments.map(async (attachment) => {
          if (attachment.virusScanStatus !== "CLEAN") {
            return {
              ...attachment,
              downloadUrl: null
            };
          }

          const signed = await services.attachmentSecurityService.createSignedDownloadToken(
            session.userId,
            {
              tenantId: tenant.id,
              attachmentId: attachment.id
            }
          );

          return {
            ...attachment,
            downloadUrl: withBasePath(
              `/api/v1/attachments/download/signed?token=${encodeURIComponent(signed.token)}`
            )
          };
        })
      );

      return {
        ...message,
        attachments
      };
    })
  );

  return (
    <div className="min-h-screen bg-[#f6f8fc] px-4 py-4 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Mail Detay</h1>
          <p className="text-sm text-slate-500">{thread.subject ?? "(Konu yok)"}</p>
        </div>
        <Link
          href={`/${tenantSlug}/mail`}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Gelen Kutusuna Dön
        </Link>
      </div>
      <MailThreadView tenantSlug={tenantSlug} tenantId={tenant.id} thread={{ ...thread, messages: hydratedMessages }} />
    </div>
  );
}
