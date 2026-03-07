"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FilterBar } from "./filter-bar";
import { MailList } from "./mail-list";
import { MailSidebar } from "./mail-sidebar";
import { SearchBar } from "./search-bar";
import { SyncStatusBadge } from "./sync-status-badge";

type WorkspaceMailbox = {
  id: string;
  email: string;
  unreadCount: number;
  connectionStatus: string | null;
  syncStates: Array<{ syncStatus: string; lastSyncedAt: string | null }>;
};

type WorkspaceThread = {
  id: string;
  mailboxId: string;
  subject: string | null;
  snippet: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  sender: string;
  latestMessageId: string | null;
  latestMessageIsRead: boolean;
  latestMessageIsSensitive: boolean;
};

type ThreadApiResponse = {
  id: string;
  mailboxId?: string;
  subject: string | null;
  snippet: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  mailbox?: {
    id: string;
  };
  messages: Array<{
    id: string;
    fromEmail: string | null;
    isRead: boolean;
    isSensitive: boolean;
  }>;
};

export function MailWorkspace({
  tenantSlug,
  tenantId,
  mailboxes,
  threads,
  selectedMailboxId,
  initialQuery,
  initialNextCursor,
  selectedThreadId
}: {
  tenantSlug: string;
  tenantId: string;
  mailboxes: WorkspaceMailbox[];
  threads: WorkspaceThread[];
  selectedMailboxId?: string;
  initialQuery?: string;
  initialNextCursor?: string | null;
  selectedThreadId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [threadItems, setThreadItems] = useState<WorkspaceThread[]>(threads);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncPending, setSyncPending] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [activeThreadId, setActiveThreadId] = useState<string | undefined>(
    selectedThreadId ?? threads[0]?.id
  );

  const currentMailboxId = searchParams.get("mailboxId") ?? selectedMailboxId;
  const currentQuery = searchParams.get("query") ?? initialQuery ?? "";
  const currentMailbox =
    mailboxes.find((mailbox) => mailbox.id === currentMailboxId) ?? mailboxes[0];

  useEffect(() => {
    setThreadItems(threads);
    setNextCursor(initialNextCursor ?? null);
    setSelectedThreadIds(new Set());
    setActiveThreadId(selectedThreadId ?? threads[0]?.id);
  }, [threads, initialNextCursor, selectedThreadId]);

  const showReconnectBanner = useMemo(() => {
    return mailboxes.some(
      (mailbox) =>
        mailbox.connectionStatus === "TOKEN_EXPIRED" ||
        mailbox.connectionStatus === "REVOKED" ||
        mailbox.connectionStatus === "ERROR"
    );
  }, [mailboxes]);

  const viewThreads = useMemo(() => {
    return threadItems.filter((thread) => {
      if (activeFilters.includes("unread") && thread.unreadCount === 0) {
        return false;
      }

      if (activeFilters.includes("sensitive") && !thread.latestMessageIsSensitive) {
        return false;
      }

      return true;
    });
  }, [activeFilters, threadItems]);

  const sidebarMailboxes = useMemo(() => {
    const unreadMap = new Map<string, number>();
    for (const thread of threadItems) {
      if (!thread.unreadCount) {
        continue;
      }

      if (!thread.mailboxId) {
        continue;
      }

      unreadMap.set(thread.mailboxId, (unreadMap.get(thread.mailboxId) ?? 0) + thread.unreadCount);
    }

    return mailboxes.map((mailbox) => ({
      ...mailbox,
      unreadCount: unreadMap.get(mailbox.id) ?? mailbox.unreadCount
    }));
  }, [mailboxes, threadItems]);

  useEffect(() => {
    if (viewThreads.length === 0) {
      setActiveThreadId(undefined);
      return;
    }

    if (!activeThreadId || !viewThreads.some((thread) => thread.id === activeThreadId)) {
      setActiveThreadId(viewThreads[0]?.id);
    }
  }, [activeThreadId, viewThreads]);

  const triggerSync = useCallback(
    async (mailboxId?: string): Promise<void> => {
      const targetMailbox = mailboxId ?? currentMailbox?.id;
      if (!targetMailbox) {
        return;
      }

      setSyncPending(true);
      setSyncError(null);

      const response = await fetch("/api/v1/mail/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          mailboxId: targetMailbox,
          mode: "incremental"
        })
      });

      const payload = (await response.json()) as {
        ok: boolean;
        error?: { message: string };
      };

      if (!payload.ok) {
        setSyncError(payload.error?.message ?? "Senkronizasyon kuyruğa alınamadı");
        setSyncPending(false);
        return;
      }

      setSyncPending(false);
      router.refresh();
    },
    [currentMailbox?.id, router, tenantId]
  );

  const openThread = useCallback(
    (threadId: string) => {
      router.push(`/${tenantSlug}/mail/${threadId}`);
    },
    [router, tenantSlug]
  );

  const toggleThreadRead = useCallback(
    async (threadId: string, readOverride?: boolean): Promise<void> => {
      const thread = threadItems.find((item) => item.id === threadId);
      if (!thread?.latestMessageId) {
        return;
      }

      const nextRead = readOverride ?? thread.unreadCount > 0;
      const previousUnread = thread.unreadCount;
      const previousRead = thread.latestMessageIsRead;

      setThreadItems((previous) =>
        previous.map((item) =>
          item.id === threadId
            ? {
                ...item,
                unreadCount: nextRead ? 0 : Math.max(1, item.unreadCount),
                latestMessageIsRead: nextRead
              }
            : item
        )
      );

      const response = await fetch(`/api/v1/mail/messages/${thread.latestMessageId}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          read: nextRead
        })
      });

      const payload = (await response.json()) as {
        ok: boolean;
        error?: { message: string };
      };

      if (!payload.ok) {
        setThreadItems((previous) =>
          previous.map((item) =>
            item.id === threadId
              ? {
                  ...item,
                  unreadCount: previousUnread,
                  latestMessageIsRead: previousRead
                }
              : item
          )
        );
        setSyncError(payload.error?.message ?? "Read/unread güncellemesi başarısız");
      }
    },
    [tenantId, threadItems]
  );

  const loadMoreThreads = useCallback(async (): Promise<void> => {
    if (!nextCursor || loadingMore) {
      return;
    }

    setLoadingMore(true);
    setLoadError(null);

    const params = new URLSearchParams({
      tenantId,
      limit: "25",
      cursor: nextCursor
    });

    if (currentMailboxId) {
      params.set("mailboxId", currentMailboxId);
    }

    if (currentQuery) {
      params.set("query", currentQuery);
    }

    const response = await fetch(`/api/v1/mail/threads?${params.toString()}`, {
      method: "GET",
      cache: "no-store"
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: { threads: ThreadApiResponse[]; nextCursor: string | null };
      error?: { message: string };
    };

    if (!payload.ok || !payload.data) {
      setLoadError(payload.error?.message ?? "Thread listesi yüklenemedi");
      setLoadingMore(false);
      return;
    }

    const mappedThreads = payload.data.threads.map(mapApiThread);
    setThreadItems((previous) => {
      const map = new Map(previous.map((item) => [item.id, item]));
      for (const thread of mappedThreads) {
        map.set(thread.id, thread);
      }
      return [...map.values()];
    });
    setNextCursor(payload.data.nextCursor ?? null);
    setLoadingMore(false);
  }, [nextCursor, loadingMore, tenantId, currentMailboxId, currentQuery]);

  const toggleThreadSelection = useCallback((threadId: string) => {
    setSelectedThreadIds((previous) => {
      const next = new Set(previous);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
  }, []);

  const markSelectedThreads = useCallback(
    async (read: boolean) => {
      const targetIds = [...selectedThreadIds];
      if (targetIds.length === 0) {
        return;
      }

      await Promise.all(targetIds.map((threadId) => toggleThreadRead(threadId, read)));
      setSelectedThreadIds(new Set());
    },
    [selectedThreadIds, toggleThreadRead]
  );

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }

      const currentIndex = viewThreads.findIndex((thread) => thread.id === activeThreadId);

      if (event.key === "j") {
        event.preventDefault();
        const nextIndex = Math.min(
          currentIndex < 0 ? 0 : currentIndex + 1,
          Math.max(viewThreads.length - 1, 0)
        );
        setActiveThreadId(viewThreads[nextIndex]?.id);
        return;
      }

      if (event.key === "k") {
        event.preventDefault();
        const nextIndex = Math.max(currentIndex < 0 ? 0 : currentIndex - 1, 0);
        setActiveThreadId(viewThreads[nextIndex]?.id);
        return;
      }

      if (event.key === "Enter" && activeThreadId) {
        event.preventDefault();
        openThread(activeThreadId);
        return;
      }

      if (event.key === "c") {
        event.preventDefault();
        router.push(`/${tenantSlug}/mail/compose`);
        return;
      }

      if (event.key === "r") {
        event.preventDefault();
        void triggerSync(currentMailboxId);
        return;
      }

      if (event.key === "e" && activeThreadId) {
        event.preventDefault();
        void toggleThreadRead(activeThreadId);
        return;
      }

      if (event.key === "x" && activeThreadId) {
        event.preventDefault();
        toggleThreadSelection(activeThreadId);
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [
    activeThreadId,
    currentMailboxId,
    openThread,
    router,
    tenantSlug,
    toggleThreadRead,
    toggleThreadSelection,
    triggerSync,
    viewThreads
  ]);

  return (
    <div className="flex h-[calc(100vh-1px)] flex-col">
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="grid gap-2 xl:grid-cols-[1fr_auto_auto]">
          <SearchBar
            defaultValue={currentQuery}
            onSearch={(query) => {
              const next = new URLSearchParams(searchParams.toString());
              if (query) {
                next.set("query", query);
              } else {
                next.delete("query");
              }
              router.push(`${pathname}?${next.toString()}`);
            }}
          />
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            onClick={() => {
              void triggerSync(currentMailboxId);
            }}
            disabled={syncPending}
          >
            {syncPending ? "Sync..." : "Sync Başlat"}
          </button>
          <button
            type="button"
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white"
            onClick={() => {
              router.push(`/${tenantSlug}/mail/compose`);
            }}
          >
            Compose
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <p>
            Kısayollar: `j/k` gezin, `enter` aç, `e` read/unread, `x` seç, `c` compose, `r` sync
          </p>
          {currentMailbox ? (
            <SyncStatusBadge
              status={currentMailbox.syncStates[0]?.syncStatus ?? "IDLE"}
              {...(currentMailbox.syncStates[0]?.lastSyncedAt === undefined
                ? {}
                : { lastSyncedAt: currentMailbox.syncStates[0]?.lastSyncedAt })}
            />
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <FilterBar active={activeFilters} onChange={setActiveFilters} />
          {selectedThreadIds.size > 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1 text-xs">
              <span>{selectedThreadIds.size} thread seçildi</span>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1"
                onClick={() => {
                  void markSelectedThreads(true);
                }}
              >
                Okundu Yap
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1"
                onClick={() => {
                  void markSelectedThreads(false);
                }}
              >
                Okunmadı Yap
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1"
                onClick={() => {
                  setSelectedThreadIds(new Set());
                }}
              >
                Temizle
              </button>
            </div>
          ) : null}
        </div>

        {showReconnectBanner ? (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Bazı mailbox bağlantılarında token sorunu var.{" "}
            <Link href={`/${tenantSlug}/settings/domains`} className="underline">
              Yeniden bağlamak için buraya gidin.
            </Link>
          </div>
        ) : null}

        {syncError ? (
          <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {syncError}
          </div>
        ) : null}
      </div>

      <div className="grid flex-1 overflow-hidden lg:grid-cols-[280px_420px_1fr]">
        <MailSidebar
          mailboxes={sidebarMailboxes}
          {...(currentMailboxId ? { selectedMailboxId: currentMailboxId } : {})}
          onSelectMailbox={(mailboxId) => {
            const next = new URLSearchParams(searchParams.toString());
            if (mailboxId) {
              next.set("mailboxId", mailboxId);
            } else {
              next.delete("mailboxId");
            }
            router.push(`${pathname}?${next.toString()}`);
          }}
        />

        <MailList
          items={viewThreads}
          {...(activeThreadId ? { activeThreadId } : {})}
          selectedThreadIds={selectedThreadIds}
          onToggleSelect={toggleThreadSelection}
          onActivate={setActiveThreadId}
          onOpen={openThread}
          hasMore={nextCursor !== null}
          loadingMore={loadingMore}
          loadError={loadError}
          onLoadMore={loadMoreThreads}
        />

        <div className="hidden items-center justify-center border-l border-slate-200 bg-white p-8 text-center text-sm text-slate-500 lg:flex">
          Bir thread seçerek detayları görüntüleyin.
        </div>
      </div>
    </div>
  );
}

function mapApiThread(thread: ThreadApiResponse): WorkspaceThread {
  return {
    id: thread.id,
    mailboxId: thread.mailbox?.id ?? thread.mailboxId ?? "",
    subject: thread.subject,
    snippet: thread.snippet,
    unreadCount: thread.unreadCount,
    lastMessageAt: thread.lastMessageAt,
    sender: thread.messages[0]?.fromEmail ?? "Unknown",
    latestMessageId: thread.messages[0]?.id ?? null,
    latestMessageIsRead: thread.messages[0]?.isRead ?? thread.unreadCount === 0,
    latestMessageIsSensitive: thread.messages[0]?.isSensitive ?? false
  };
}
