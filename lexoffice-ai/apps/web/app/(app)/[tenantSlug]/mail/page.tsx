import { listThreadsSchema } from "@lexoffice/contracts";
import { prisma } from "@lexoffice/db";
import { PERMISSIONS } from "@lexoffice/core";
import { MailWorkspace } from "@/components/mail/mail-workspace";
import { services } from "@/lib/services";
import { getTenantContext } from "@/lib/tenant-context";

type ComposeFont = "system" | "sans" | "serif" | "mono";

export default async function MailPage({
  params,
  searchParams
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    mailboxId?: string;
    query?: string;
    view?: string;
    labelId?: string;
    readStatus?: string;
    dateFrom?: string;
    dateTo?: string;
    withAttachments?: string;
    onlyStarred?: string;
    sortBy?: string;
    sortDirection?: string;
  }>;
}) {
  const { tenantSlug } = await params;
  const query = await searchParams;

  const { tenant, session } = await getTenantContext(tenantSlug);
  await services.rbacService.requirePermission(session.userId, tenant.id, PERMISSIONS.MAILBOX_VIEW);

  const parsedThreadInput = listThreadsSchema.safeParse({
    tenantId: tenant.id,
    mailboxId: query.mailboxId,
    query: query.query,
    view: query.view ?? "inbox",
    labelId: query.labelId,
    readStatus: query.readStatus ?? "all",
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    withAttachments: query.withAttachments === "true",
    onlyStarred: query.onlyStarred === "true",
    sortBy: query.sortBy ?? "date",
    sortDirection: query.sortDirection ?? "desc",
    limit: 50
  });
  const threadInput = parsedThreadInput.success
    ? parsedThreadInput.data
    : listThreadsSchema.parse({ tenantId: tenant.id, limit: 50 });

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

  const unreadSummary = await prisma.mailThread.groupBy({
    where: {
      tenantId: tenant.id,
      deletedAt: null
    },
    by: ["mailboxId"],
    _sum: {
      unreadCount: true
    }
  });

  const { threads, nextCursor } = await services.mailThreadService.listThreads(threadInput);
  const labels = await services.mailThreadService.listLabels(tenant.id, query.mailboxId);

  const unreadByMailbox = new Map<string, number>();
  for (const row of unreadSummary) {
    unreadByMailbox.set(row.mailboxId, row._sum.unreadCount ?? 0);
  }

  return (
    <MailWorkspace
      tenantSlug={tenantSlug}
      tenantId={tenant.id}
      composeDefaultFont={normalizeComposeFont(tenant.settings?.composeDefaultFont)}
      {...(query.mailboxId ? { selectedMailboxId: query.mailboxId } : {})}
      {...(query.query ? { initialQuery: query.query } : {})}
      initialView={threadInput.view}
      {...(query.labelId ? { selectedLabelId: query.labelId } : {})}
      initialReadStatus={threadInput.readStatus}
      {...(threadInput.dateFrom ? { initialDateFrom: threadInput.dateFrom } : {})}
      {...(threadInput.dateTo ? { initialDateTo: threadInput.dateTo } : {})}
      initialWithAttachments={threadInput.withAttachments}
      initialOnlyStarred={threadInput.onlyStarred}
      initialSortBy={threadInput.sortBy}
      initialSortDirection={threadInput.sortDirection}
      initialNextCursor={nextCursor}
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
      labels={labels.map((label) => ({
        id: label.id,
        mailboxId: label.mailboxId,
        name: label.name,
        color: label.color,
        isSystem: label.isSystem,
        type: label.type
      }))}
      threads={threads.map((thread) => ({
        id: thread.id,
        mailboxId: thread.mailboxId,
        subject: thread.subject,
        snippet: thread.snippet,
        unreadCount: thread.unreadCount,
        kind: thread.kind,
        draftId: thread.draftId,
        isPinned: thread.isPinned,
        pinnedAt: thread.pinnedAt ? thread.pinnedAt.toISOString() : null,
        readLaterAt: thread.readLaterAt ? thread.readLaterAt.toISOString() : null,
        reminderAt: thread.reminderAt ? thread.reminderAt.toISOString() : null,
        note: thread.note ?? null,
        lastMessageAt: thread.lastMessageAt ? thread.lastMessageAt.toISOString() : null,
        latestMessageId: thread.messages[0]?.id ?? null,
        sender: thread.messages[0]?.fromName ?? thread.messages[0]?.fromEmail ?? "Unknown",
        latestMessageIsRead: thread.messages[0]?.isRead ?? thread.unreadCount === 0,
        latestMessageIsSensitive: thread.messages[0]?.isSensitive ?? false,
        latestMessageIsStarred: thread.messages[0]?.isStarred ?? false,
        latestMessageIsImportant: thread.messages[0]?.isImportant ?? false,
        latestMessageState: thread.messages[0]?.state ?? null
      }))}
    />
  );
}

function normalizeComposeFont(value: string | null | undefined): ComposeFont {
  if (value === "system" || value === "sans" || value === "serif" || value === "mono") {
    return value;
  }
  return "sans";
}
