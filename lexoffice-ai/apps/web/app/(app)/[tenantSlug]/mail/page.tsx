import Link from "next/link";
import { prisma } from "@lexoffice/db";
import { Topbar } from "@/components/app/topbar";
import { MailWorkspace } from "@/components/mail/mail-workspace";
import { getTenantContext } from "@/lib/tenant-context";

export default async function MailPage({
  params,
  searchParams
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ mailboxId?: string; query?: string }>;
}) {
  const { tenantSlug } = await params;
  const query = await searchParams;

  const { tenant } = await getTenantContext(tenantSlug);

  const mailboxes = await prisma.mailbox.findMany({
    where: {
      tenantId: tenant.id,
      deletedAt: null
    },
    include: {
      syncStates: {
        orderBy: { updatedAt: "desc" },
        take: 1
      },
      connections: {
        where: {
          status: {
            in: ["CONNECTED", "TOKEN_EXPIRED", "REVOKED", "ERROR"]
          }
        },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          status: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  const threads = await prisma.mailThread.findMany({
    where: {
      tenantId: tenant.id,
      deletedAt: null,
      ...(query.mailboxId ? { mailboxId: query.mailboxId } : {}),
      ...(query.query
        ? {
            OR: [
              { subject: { contains: query.query, mode: "insensitive" } },
              { snippet: { contains: query.query, mode: "insensitive" } }
            ]
          }
        : {})
    },
    include: {
      messages: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fromEmail: true,
          isRead: true,
          isSensitive: true
        }
      }
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    take: 50
  });

  const lastThread = threads.at(-1);
  const initialNextCursor =
    threads.length >= 50 && lastThread?.lastMessageAt
      ? lastThread.lastMessageAt.toISOString()
      : null;

  const unreadByMailbox = new Map<string, number>();
  for (const thread of threads) {
    const current = unreadByMailbox.get(thread.mailboxId) ?? 0;
    unreadByMailbox.set(thread.mailboxId, current + thread.unreadCount);
  }

  return (
    <>
      <Topbar title="Unified Inbox" subtitle="Çok sağlayıcılı mail paneli" />
      <div className="border-b border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 sm:px-6">
        <Link
          className="rounded-md border border-slate-300 px-2 py-1"
          href={`/${tenantSlug}/mail/compose`}
        >
          Compose
        </Link>
      </div>
      <MailWorkspace
        tenantSlug={tenantSlug}
        tenantId={tenant.id}
        {...(query.mailboxId ? { selectedMailboxId: query.mailboxId } : {})}
        {...(query.query ? { initialQuery: query.query } : {})}
        initialNextCursor={initialNextCursor}
        mailboxes={mailboxes.map((mailbox) => ({
          id: mailbox.id,
          email: mailbox.email,
          unreadCount: unreadByMailbox.get(mailbox.id) ?? 0,
          connectionStatus: mailbox.connections[0]?.status ?? null,
          syncStates: mailbox.syncStates.map((state) => ({
            syncStatus: state.syncStatus,
            lastSyncedAt: state.lastSyncedAt ? state.lastSyncedAt.toISOString() : null
          }))
        }))}
        threads={threads.map((thread) => ({
          id: thread.id,
          mailboxId: thread.mailboxId,
          subject: thread.subject,
          snippet: thread.snippet,
          unreadCount: thread.unreadCount,
          lastMessageAt: thread.lastMessageAt ? thread.lastMessageAt.toISOString() : null,
          latestMessageId: thread.messages[0]?.id ?? null,
          sender: thread.messages[0]?.fromEmail ?? "Unknown",
          latestMessageIsRead: thread.messages[0]?.isRead ?? thread.unreadCount === 0,
          latestMessageIsSensitive: thread.messages[0]?.isSensitive ?? false
        }))}
      />
    </>
  );
}
