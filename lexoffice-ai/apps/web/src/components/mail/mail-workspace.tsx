"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  APPEARANCE_CHANGED_EVENT,
  readAppearancePreferences
} from "@/lib/appearance-preferences";
import { withBasePath } from "@/lib/base-path";
import { FilterBar } from "./filter-bar";
import { MailList } from "./mail-list";
import { MailSidebar } from "./mail-sidebar";
import { SearchBar } from "./search-bar";
import { SyncStatusBadge } from "./sync-status-badge";

type SidebarView =
  | "inbox"
  | "unread"
  | "starred"
  | "important"
  | "drafts"
  | "sent"
  | "trash"
  | "spam"
  | "archive"
  | "label";

type ReadStatus = "all" | "read" | "unread";
type SortBy = "date" | "sender";
type SortDirection = "asc" | "desc";

type WorkspaceMailbox = {
  id: string;
  email: string;
  unreadCount: number;
  connectionStatus: string | null;
  syncStates: Array<{ syncStatus: string; lastSyncedAt: string | null }>;
};

type WorkspaceLabel = {
  id: string;
  mailboxId: string;
  name: string;
  color: string | null;
  isSystem: boolean;
  type: string;
};

type WorkspaceThread = {
  id: string;
  mailboxId: string;
  subject: string | null;
  snippet: string | null;
  unreadCount: number;
  kind: "THREAD" | "DRAFT";
  draftId: string | null;
  lastMessageAt: string | null;
  sender: string;
  latestMessageId: string | null;
  latestMessageIsRead: boolean;
  latestMessageIsSensitive: boolean;
  latestMessageIsStarred: boolean;
  latestMessageIsImportant: boolean;
  latestMessageState: string | null;
};

type ThreadApiResponse = {
  id: string;
  kind?: "THREAD" | "DRAFT";
  draftId?: string | null;
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
    fromName?: string | null;
    isRead: boolean;
    isSensitive: boolean;
    isStarred: boolean;
    isImportant: boolean;
    state: string | null;
  }>;
};

const THREAD_CACHE_STORAGE_PREFIX = "lexoffice.mail.thread-cache";
const THREAD_CACHE_TTL_MS = 20 * 60 * 1000;
const THREAD_CACHE_MAX_ITEMS = 400;
const MAIL_NOTIFICATION_PREFS_STORAGE_KEY = "lexoffice.mail.notification-preferences";

type MailNotificationPreferences = {
  desktopEnabled: boolean;
  soundEnabled: boolean;
  importantOnly: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
};

const DEFAULT_MAIL_NOTIFICATION_PREFERENCES: MailNotificationPreferences = {
  desktopEnabled: false,
  soundEnabled: false,
  importantOnly: false,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00"
};

export function MailWorkspace({
  tenantSlug,
  tenantId,
  mailboxes,
  labels,
  threads,
  selectedMailboxId,
  initialQuery,
  initialView,
  selectedLabelId,
  initialReadStatus,
  initialDateFrom,
  initialDateTo,
  initialWithAttachments,
  initialOnlyStarred,
  initialSortBy,
  initialSortDirection,
  initialNextCursor,
  selectedThreadId
}: {
  tenantSlug: string;
  tenantId: string;
  mailboxes: WorkspaceMailbox[];
  labels: WorkspaceLabel[];
  threads: WorkspaceThread[];
  selectedMailboxId?: string;
  initialQuery?: string;
  initialView: SidebarView;
  selectedLabelId?: string;
  initialReadStatus: ReadStatus;
  initialDateFrom?: string;
  initialDateTo?: string;
  initialWithAttachments: boolean;
  initialOnlyStarred: boolean;
  initialSortBy: SortBy;
  initialSortDirection: SortDirection;
  initialNextCursor?: string | null;
  selectedThreadId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [threadItems, setThreadItems] = useState<WorkspaceThread[]>(threads);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncPending, setSyncPending] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [notificationPreferences, setNotificationPreferences] = useState<MailNotificationPreferences>(
    DEFAULT_MAIL_NOTIFICATION_PREFERENCES
  );
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const [mailLayoutMode, setMailLayoutMode] = useState<"split" | "list">("split");
  const [showFilters, setShowFilters] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [activeThreadId, setActiveThreadId] = useState<string | undefined>(
    selectedThreadId ?? threads[0]?.id
  );
  const [bulkLabelId, setBulkLabelId] = useState<string | undefined>(selectedLabelId);
  const audioContextRef = useRef<AudioContext | null>(null);
  const notifiedUnreadThreadIdsRef = useRef<Set<string>>(new Set());
  const notificationBaselineReadyRef = useRef(false);

  const currentMailboxId = searchParams.get("mailboxId") ?? selectedMailboxId;
  const currentQuery = searchParams.get("query") ?? initialQuery ?? "";
  const currentView = parseView(searchParams.get("view")) ?? initialView;
  const currentLabelId = searchParams.get("labelId") ?? selectedLabelId;
  const currentReadStatus = parseReadStatus(searchParams.get("readStatus")) ?? initialReadStatus;
  const currentDateFrom = searchParams.get("dateFrom") ?? initialDateFrom ?? "";
  const currentDateTo = searchParams.get("dateTo") ?? initialDateTo ?? "";
  const currentWithAttachments =
    parseBoolean(searchParams.get("withAttachments")) ?? initialWithAttachments;
  const currentOnlyStarred = parseBoolean(searchParams.get("onlyStarred")) ?? initialOnlyStarred;
  const currentSortBy = parseSortBy(searchParams.get("sortBy")) ?? initialSortBy;
  const currentSortDirection = parseSortDirection(searchParams.get("sortDirection")) ?? initialSortDirection;
  const threadCacheKey = useMemo(
    () =>
      buildThreadCacheKey({
        tenantId,
        mailboxId: currentMailboxId ?? "all",
        view: currentView,
        labelId: currentLabelId ?? "none",
        query: currentQuery,
        readStatus: currentReadStatus,
        dateFrom: currentDateFrom,
        dateTo: currentDateTo,
        withAttachments: currentWithAttachments,
        onlyStarred: currentOnlyStarred,
        sortBy: currentSortBy,
        sortDirection: currentSortDirection
      }),
    [
      currentDateFrom,
      currentDateTo,
      currentLabelId,
      currentMailboxId,
      currentOnlyStarred,
      currentQuery,
      currentReadStatus,
      currentSortBy,
      currentSortDirection,
      currentView,
      currentWithAttachments,
      tenantId
    ]
  );

  const currentMailbox =
    mailboxes.find((mailbox) => mailbox.id === currentMailboxId) ?? mailboxes[0];

  const visibleLabels = useMemo(() => {
    if (!currentMailboxId) {
      return labels;
    }
    return labels.filter((label) => label.mailboxId === currentMailboxId);
  }, [currentMailboxId, labels]);

  useEffect(() => {
    setThreadItems(threads);
    setNextCursor(initialNextCursor ?? null);
    setSelectedThreadIds(new Set());
    setActiveThreadId(selectedThreadId ?? threads[0]?.id);
  }, [threads, initialNextCursor, selectedThreadId]);

  useEffect(() => {
    const cached = readThreadCache(threadCacheKey);
    if (!cached) {
      return;
    }

    if (cached.items.length <= threads.length) {
      if ((initialNextCursor ?? null) === null && cached.nextCursor) {
        setNextCursor(cached.nextCursor);
      }
      return;
    }

    setThreadItems((previous) => mergeThreadLists(cached.items, previous));
    if ((initialNextCursor ?? null) === null && cached.nextCursor) {
      setNextCursor(cached.nextCursor);
    }
  }, [initialNextCursor, threadCacheKey, threads.length]);

  useEffect(() => {
    writeThreadCache(threadCacheKey, {
      cachedAt: Date.now(),
      nextCursor,
      items: threadItems.slice(0, THREAD_CACHE_MAX_ITEMS)
    });
  }, [nextCursor, threadCacheKey, threadItems]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const raw = window.localStorage.getItem(MAIL_NOTIFICATION_PREFS_STORAGE_KEY);
    if (!raw) {
      const legacyDesktop = window.localStorage.getItem("mail.desktopNotifications.enabled") === "true";
      setNotificationPreferences((previous) => ({
        ...previous,
        desktopEnabled: legacyDesktop
      }));
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      setNotificationPreferences(normalizeMailNotificationPreferences(parsed));
    } catch {
      setNotificationPreferences(DEFAULT_MAIL_NOTIFICATION_PREFERENCES);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      MAIL_NOTIFICATION_PREFS_STORAGE_KEY,
      JSON.stringify(notificationPreferences)
    );
    window.localStorage.setItem(
      "mail.desktopNotifications.enabled",
      notificationPreferences.desktopEnabled ? "true" : "false"
    );
  }, [notificationPreferences]);

  useEffect(() => {
    const syncFromAppearance = () => {
      const appearance = readAppearancePreferences();
      setMailLayoutMode(appearance.mailLayout);
    };

    syncFromAppearance();
    window.addEventListener(APPEARANCE_CHANGED_EVENT, syncFromAppearance);
    window.addEventListener("storage", syncFromAppearance);

    return () => {
      window.removeEventListener(APPEARANCE_CHANGED_EVENT, syncFromAppearance);
      window.removeEventListener("storage", syncFromAppearance);
    };
  }, []);

  useEffect(() => {
    const unreadThreads = threadItems.filter((thread) => thread.unreadCount > 0);
    const unreadIdSet = new Set(unreadThreads.map((thread) => thread.id));

    for (const knownId of Array.from(notifiedUnreadThreadIdsRef.current)) {
      if (!unreadIdSet.has(knownId)) {
        notifiedUnreadThreadIdsRef.current.delete(knownId);
      }
    }

    if (!notificationBaselineReadyRef.current) {
      notifiedUnreadThreadIdsRef.current = unreadIdSet;
      notificationBaselineReadyRef.current = true;
      return;
    }

    const newlyUnread = unreadThreads.filter(
      (thread) => !notifiedUnreadThreadIdsRef.current.has(thread.id)
    );

    const notificationCandidates = notificationPreferences.importantOnly
      ? newlyUnread.filter((thread) => thread.latestMessageIsImportant)
      : newlyUnread;
    const inQuietHours =
      notificationPreferences.quietHoursEnabled &&
      isWithinQuietHours(
        new Date(),
        notificationPreferences.quietHoursStart,
        notificationPreferences.quietHoursEnd
      );

    if (
      notificationPreferences.desktopEnabled &&
      !inQuietHours &&
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      for (const thread of notificationCandidates.slice(0, 3)) {
        const title = `Yeni mail: ${thread.sender}`;
        const body = thread.subject ?? thread.snippet ?? "(Konu yok)";
        new Notification(title, {
          body,
          tag: `mail-thread-${thread.id}`
        });
      }
    }

    if (notificationPreferences.soundEnabled && !inQuietHours && notificationCandidates.length > 0) {
      playNotificationSound(audioContextRef);
    }

    for (const thread of newlyUnread) {
      notifiedUnreadThreadIdsRef.current.add(thread.id);
    }
  }, [notificationPreferences, threadItems]);

  useEffect(() => {
    if (visibleLabels.length === 0) {
      setBulkLabelId(undefined);
      return;
    }

    if (!bulkLabelId || !visibleLabels.some((label) => label.id === bulkLabelId)) {
      setBulkLabelId(visibleLabels[0]?.id);
    }
  }, [bulkLabelId, visibleLabels]);

  const updateNotificationPreferences = useCallback(
    (updater: (current: MailNotificationPreferences) => MailNotificationPreferences) => {
      setNotificationPreferences((current) => updater(current));
    },
    []
  );

  const toggleDesktopNotifications = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }

    if (!("Notification" in window)) {
      setSyncError("Tarayıcı masaüstü bildirimi desteklemiyor.");
      return;
    }

    if (notificationPreferences.desktopEnabled) {
      updateNotificationPreferences((current) => ({ ...current, desktopEnabled: false }));
      return;
    }

    if (Notification.permission === "denied") {
      setSyncError("Tarayıcı bildirim izni engellendi. Tarayıcı ayarlarından izin verin.");
      return;
    }

    if (Notification.permission !== "granted") {
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        setSyncError("Masaüstü bildirim izni verilmedi.");
        return;
      }
    }

    updateNotificationPreferences((current) => ({ ...current, desktopEnabled: true }));
    setSyncError(null);
  }, [notificationPreferences.desktopEnabled, updateNotificationPreferences]);

  const showReconnectBanner = useMemo(() => {
    return mailboxes.some(
      (mailbox) =>
        mailbox.connectionStatus === "TOKEN_EXPIRED" ||
        mailbox.connectionStatus === "REVOKED" ||
        mailbox.connectionStatus === "ERROR"
    );
  }, [mailboxes]);

  const viewThreads = useMemo(() => {
    const filtered = threadItems.filter((thread) => {
      if (sensitiveOnly && !thread.latestMessageIsSensitive) {
        return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((left, right) => {
      if (currentSortBy === "sender") {
        const result = left.sender.localeCompare(right.sender, "tr", { sensitivity: "base" });
        return currentSortDirection === "asc" ? result : -result;
      }

      const leftTime = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0;
      const rightTime = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0;
      const result = leftTime - rightTime;
      return currentSortDirection === "asc" ? result : -result;
    });

    return sorted;
  }, [currentSortBy, currentSortDirection, sensitiveOnly, threadItems]);

  const sidebarMailboxes = useMemo(() => {
    const unreadMap = new Map<string, number>();
    for (const thread of threadItems) {
      if (!thread.unreadCount) {
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

  const setQueryParams = useCallback(
    (updater: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      updater(next);
      const query = next.toString();
      router.push(query.length > 0 ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams]
  );

  const triggerSync = useCallback(
    async (mailboxId?: string): Promise<void> => {
      const targetMailbox = mailboxId ?? currentMailbox?.id;
      if (!targetMailbox) {
        return;
      }

      setSyncPending(true);
      setSyncError(null);

      const response = await fetch(withBasePath("/api/v1/mail/sync/trigger"), {
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
      const thread = threadItems.find((item) => item.id === threadId);
      if (!thread) {
        return;
      }

      if (thread.kind === "DRAFT" && thread.draftId) {
        router.push(`/${tenantSlug}/mail/compose?draftId=${encodeURIComponent(thread.draftId)}`);
        return;
      }

      router.push(`/${tenantSlug}/mail/${threadId}`);
    },
    [router, tenantSlug, threadItems]
  );

  const toggleThreadRead = useCallback(
    async (threadId: string, readOverride?: boolean): Promise<void> => {
      const thread = threadItems.find((item) => item.id === threadId);
      if (!thread || thread.kind === "DRAFT" || !thread.latestMessageId) {
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

      const response = await fetch(withBasePath(`/api/v1/mail/messages/${thread.latestMessageId}/read`), {
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

  const toggleFlag = useCallback(
    async (threadId: string, kind: "isStarred" | "isImportant"): Promise<void> => {
      const thread = threadItems.find((item) => item.id === threadId);
      if (!thread || thread.kind === "DRAFT" || !thread.latestMessageId) {
        return;
      }

      const nextValue =
        kind === "isStarred" ? !thread.latestMessageIsStarred : !thread.latestMessageIsImportant;

      setThreadItems((previous) =>
        previous.map((item) =>
          item.id === threadId
            ? {
                ...item,
                ...(kind === "isStarred"
                  ? { latestMessageIsStarred: nextValue }
                  : { latestMessageIsImportant: nextValue })
              }
            : item
        )
      );

      const response = await fetch(withBasePath(`/api/v1/mail/messages/${thread.latestMessageId}/flags`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          ...(kind === "isStarred" ? { isStarred: nextValue } : { isImportant: nextValue })
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
                  ...(kind === "isStarred"
                    ? { latestMessageIsStarred: thread.latestMessageIsStarred }
                    : { latestMessageIsImportant: thread.latestMessageIsImportant })
                }
              : item
          )
        );
        setSyncError(payload.error?.message ?? "Mesaj bayrak güncellemesi başarısız");
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
      cursor: nextCursor,
      view: currentView,
      readStatus: currentReadStatus,
      sortBy: currentSortBy,
      sortDirection: currentSortDirection
    });

    if (currentMailboxId) {
      params.set("mailboxId", currentMailboxId);
    }

    if (currentQuery) {
      params.set("query", currentQuery);
    }

    if (currentView === "label" && currentLabelId) {
      params.set("labelId", currentLabelId);
    }

    if (currentDateFrom) {
      params.set("dateFrom", currentDateFrom);
    }

    if (currentDateTo) {
      params.set("dateTo", currentDateTo);
    }

    if (currentWithAttachments) {
      params.set("withAttachments", "true");
    }

    if (currentOnlyStarred) {
      params.set("onlyStarred", "true");
    }

    const response = await fetch(withBasePath(`/api/v1/mail/threads?${params.toString()}`), {
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
  }, [
    nextCursor,
    loadingMore,
    tenantId,
    currentMailboxId,
    currentQuery,
    currentView,
    currentReadStatus,
    currentDateFrom,
    currentDateTo,
    currentWithAttachments,
    currentOnlyStarred,
    currentSortBy,
    currentSortDirection,
    currentLabelId
  ]);

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

  const moveSelectedThreads = useCallback(
    async (state: "RECEIVED" | "ARCHIVED" | "SPAM" | "TRASH") => {
      const selectedThreads = [...selectedThreadIds]
        .map((threadId) => threadItems.find((thread) => thread.id === threadId))
        .filter((thread): thread is WorkspaceThread => Boolean(thread));

      const targetMessageIds = selectedThreads
        .filter((thread) => thread.kind === "THREAD" && thread.latestMessageId)
        .map((thread) => thread.latestMessageId as string);

      if (targetMessageIds.length === 0) {
        setSyncError("Taşınacak uygun mesaj bulunamadı");
        return;
      }

      const results = await Promise.all(
        targetMessageIds.map(async (messageId) => {
          const response = await fetch(withBasePath(`/api/v1/mail/messages/${messageId}/state`), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenantId,
              state
            })
          });

          return response.json() as Promise<{
            ok: boolean;
            error?: { message: string };
          }>;
        })
      );

      const failed = results.find((result) => !result.ok);
      if (failed) {
        setSyncError(failed.error?.message ?? "Taşıma işlemi başarısız");
        return;
      }

      setSelectedThreadIds(new Set());
      router.refresh();
    },
    [router, selectedThreadIds, tenantId, threadItems]
  );

  const applyLabelToSelectedThreads = useCallback(async (): Promise<void> => {
    if (!bulkLabelId) {
      return;
    }

    const selectedThreads = [...selectedThreadIds]
      .map((threadId) => threadItems.find((thread) => thread.id === threadId))
      .filter((thread): thread is WorkspaceThread => Boolean(thread));

    const targetMessageIds = selectedThreads
      .filter((thread) => thread.kind === "THREAD" && thread.latestMessageId)
      .map((thread) => thread.latestMessageId as string);

    if (targetMessageIds.length === 0) {
      setSyncError("Etiketlenecek uygun mesaj bulunamadı");
      return;
    }

    const results = await Promise.all(
      targetMessageIds.map(async (messageId) => {
        const response = await fetch(withBasePath(`/api/v1/mail/messages/${messageId}/labels`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId,
            labelId: bulkLabelId,
            action: "add"
          })
        });

        return response.json() as Promise<{
          ok: boolean;
          error?: { message: string };
        }>;
      })
    );

    const failed = results.find((result) => !result.ok);
    if (failed) {
      setSyncError(failed.error?.message ?? "Etiketleme işlemi başarısız");
      return;
    }

    setSelectedThreadIds(new Set());
    router.refresh();
  }, [bulkLabelId, router, selectedThreadIds, tenantId, threadItems]);

  const createLabel = useCallback(async (): Promise<void> => {
    if (!currentMailbox?.id) {
      setSyncError("Etiket eklemek için bir mailbox seçin.");
      return;
    }

    const name = window.prompt("Yeni etiket adı");
    if (!name || name.trim().length === 0) {
      return;
    }

    const response = await fetch(withBasePath("/api/v1/mail/labels"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        mailboxId: currentMailbox.id,
        name: name.trim()
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setSyncError(payload.error?.message ?? "Etiket oluşturulamadı");
      return;
    }

    router.refresh();
  }, [currentMailbox?.id, router, tenantId]);

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
    <div className="flex h-screen flex-col bg-[#f6f8fc]">
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[260px] flex-1">
            <SearchBar
              defaultValue={currentQuery}
              onSearch={(query) => {
                setQueryParams((next) => {
                  if (query) {
                    next.set("query", query);
                  } else {
                    next.delete("query");
                  }
                  next.delete("cursor");
                });
              }}
            />
          </div>
          <button
            type="button"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            onClick={() => {
              void triggerSync(currentMailboxId);
            }}
            disabled={syncPending}
          >
            {syncPending ? "Yenileniyor..." : "Yenile"}
          </button>
          <button
            type="button"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            onClick={() => setShowFilters((current) => !current)}
          >
            {showFilters ? "Filtreleri Gizle" : "Filtreler"}
          </button>
          <button
            type="button"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            onClick={() => setShowNotificationSettings((current) => !current)}
          >
            {showNotificationSettings ? "Bildirimleri Gizle" : "Bildirimler"}
          </button>
          {currentMailbox ? (
            <SyncStatusBadge
              status={currentMailbox.syncStates[0]?.syncStatus ?? "IDLE"}
              {...(currentMailbox.syncStates[0]?.lastSyncedAt === undefined
                ? {}
                : { lastSyncedAt: currentMailbox.syncStates[0]?.lastSyncedAt })}
            />
          ) : null}
        </div>

        {showFilters ? (
          <div className="mt-3">
            <FilterBar
              readStatus={currentReadStatus}
              dateFrom={currentDateFrom}
              dateTo={currentDateTo}
              withAttachments={currentWithAttachments}
              onlyStarred={currentOnlyStarred}
              sortBy={currentSortBy}
              sortDirection={currentSortDirection}
              sensitiveOnly={sensitiveOnly}
              onReadStatusChange={(value) => {
                setQueryParams((next) => {
                  if (value === "all") {
                    next.delete("readStatus");
                  } else {
                    next.set("readStatus", value);
                  }
                  next.delete("cursor");
                });
              }}
              onDateFromChange={(value) => {
                setQueryParams((next) => {
                  if (value.length > 0) {
                    next.set("dateFrom", value);
                  } else {
                    next.delete("dateFrom");
                  }
                  next.delete("cursor");
                });
              }}
              onDateToChange={(value) => {
                setQueryParams((next) => {
                  if (value.length > 0) {
                    next.set("dateTo", value);
                  } else {
                    next.delete("dateTo");
                  }
                  next.delete("cursor");
                });
              }}
              onWithAttachmentsChange={(value) => {
                setQueryParams((next) => {
                  if (value) {
                    next.set("withAttachments", "true");
                  } else {
                    next.delete("withAttachments");
                  }
                  next.delete("cursor");
                });
              }}
              onOnlyStarredChange={(value) => {
                setQueryParams((next) => {
                  if (value) {
                    next.set("onlyStarred", "true");
                  } else {
                    next.delete("onlyStarred");
                  }
                  next.delete("cursor");
                });
              }}
              onSortByChange={(value) => {
                setQueryParams((next) => {
                  if (value === "date") {
                    next.delete("sortBy");
                  } else {
                    next.set("sortBy", value);
                  }
                  next.delete("cursor");
                });
              }}
              onSortDirectionChange={(value) => {
                setQueryParams((next) => {
                  if (value === "desc") {
                    next.delete("sortDirection");
                  } else {
                    next.set("sortDirection", value);
                  }
                  next.delete("cursor");
                });
              }}
              onSensitiveToggle={() => setSensitiveOnly((current) => !current)}
            />
          </div>
        ) : null}

        {showNotificationSettings ? (
          <div className="mt-3 rounded-xl border border-slate-300 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Bildirim Ayarları
            </p>
            <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={notificationPreferences.desktopEnabled}
                  onChange={() => {
                    void toggleDesktopNotifications();
                  }}
                />
                Masaüstü bildirimi
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={notificationPreferences.soundEnabled}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    updateNotificationPreferences((current) => ({ ...current, soundEnabled: checked }));
                    if (checked) {
                      playNotificationSound(audioContextRef);
                    }
                  }}
                />
                Bildirim sesi
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={notificationPreferences.importantOnly}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    updateNotificationPreferences((current) => ({ ...current, importantOnly: checked }));
                  }}
                />
                Sadece önemli mailler
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={notificationPreferences.quietHoursEnabled}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    updateNotificationPreferences((current) => ({
                      ...current,
                      quietHoursEnabled: checked
                    }));
                  }}
                />
                Sessiz saatler
              </label>
            </div>
            {notificationPreferences.quietHoursEnabled ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span>Sessiz aralık:</span>
                <input
                  type="time"
                  className="rounded border border-slate-300 bg-white px-2 py-1"
                  value={notificationPreferences.quietHoursStart}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    updateNotificationPreferences((current) => ({ ...current, quietHoursStart: value }));
                  }}
                />
                <span>-</span>
                <input
                  type="time"
                  className="rounded border border-slate-300 bg-white px-2 py-1"
                  value={notificationPreferences.quietHoursEnd}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    updateNotificationPreferences((current) => ({ ...current, quietHoursEnd: value }));
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedThreadIds.size > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs">
            <span className="font-medium text-slate-700">{selectedThreadIds.size} mail seçildi</span>
            <button
              type="button"
              className="rounded border border-slate-300 bg-white px-2 py-1"
              onClick={() => {
                void markSelectedThreads(true);
              }}
            >
              Okundu
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 bg-white px-2 py-1"
              onClick={() => {
                void markSelectedThreads(false);
              }}
            >
              Okunmadı
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 bg-white px-2 py-1"
              onClick={() => {
                void moveSelectedThreads("ARCHIVED");
              }}
            >
              Arşivle
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 bg-white px-2 py-1"
              onClick={() => {
                void moveSelectedThreads("SPAM");
              }}
            >
              Spam
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 bg-white px-2 py-1"
              onClick={() => {
                void moveSelectedThreads("TRASH");
              }}
            >
              Çöp
            </button>
            {visibleLabels.length > 0 ? (
              <>
                <select
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                  value={bulkLabelId ?? ""}
                  onChange={(event) => {
                    setBulkLabelId(event.target.value || undefined);
                  }}
                >
                  {visibleLabels.map((label) => (
                    <option key={label.id} value={label.id}>
                      {label.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded border border-slate-300 bg-white px-2 py-1"
                  onClick={() => {
                    void applyLabelToSelectedThreads();
                  }}
                >
                  Etiketle
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="rounded border border-slate-300 bg-white px-2 py-1"
              onClick={() => {
                setSelectedThreadIds(new Set());
              }}
            >
              Temizle
            </button>
          </div>
        ) : null}

        {showReconnectBanner ? (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Bazı mailbox bağlantılarında token sorunu var.{" "}
            <Link href={`/${tenantSlug}/settings/domains`} className="underline">
              Yeniden bağla
            </Link>
          </div>
        ) : null}

        {syncError ? (
          <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {syncError}
          </div>
        ) : null}
      </div>

      <div
        className={`grid flex-1 overflow-hidden ${
          mailLayoutMode === "split" ? "lg:grid-cols-[260px_500px_1fr]" : "lg:grid-cols-[260px_1fr]"
        }`}
      >
        <MailSidebar
          mailboxes={sidebarMailboxes}
          labels={visibleLabels}
          selectedView={currentView}
          {...(currentMailboxId ? { selectedMailboxId: currentMailboxId } : {})}
          {...(currentLabelId ? { selectedLabelId: currentLabelId } : {})}
          onSelectMailbox={(mailboxId) => {
            setQueryParams((next) => {
              if (mailboxId) {
                next.set("mailboxId", mailboxId);
              } else {
                next.delete("mailboxId");
              }
              next.delete("cursor");
            });
          }}
          onSelectView={(view, labelId) => {
            setQueryParams((next) => {
              if (view === "inbox") {
                next.delete("view");
              } else {
                next.set("view", view);
              }

              if (view === "label" && labelId) {
                next.set("labelId", labelId);
              } else {
                next.delete("labelId");
              }
              next.delete("cursor");
            });
          }}
          onCreateLabel={() => {
            void createLabel();
          }}
          onCompose={() => {
            router.push(`/${tenantSlug}/mail/compose`);
          }}
        />

        <MailList
          items={viewThreads}
          {...(activeThreadId ? { activeThreadId } : {})}
          selectedThreadIds={selectedThreadIds}
          onToggleSelect={toggleThreadSelection}
          onToggleStar={(threadId) => {
            void toggleFlag(threadId, "isStarred");
          }}
          onToggleImportant={(threadId) => {
            void toggleFlag(threadId, "isImportant");
          }}
          onActivate={setActiveThreadId}
          onOpen={openThread}
          hasMore={nextCursor !== null}
          loadingMore={loadingMore}
          loadError={loadError}
          onLoadMore={loadMoreThreads}
        />

        {mailLayoutMode === "split" ? (
          <div className="hidden border-l border-slate-200 bg-white p-6 lg:flex lg:flex-col lg:justify-between">
            <div>
              <p className="text-base font-semibold text-slate-800">Mail Önizleme</p>
              <p className="mt-2 text-sm text-slate-500">
                Listeden bir mail seçip açın. Daha sade ve hızlı akış için önizleme panelini pasif tutuyoruz.
              </p>
            </div>
            {activeThreadId ? (
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                onClick={() => {
                  openThread(activeThreadId);
                }}
              >
                Seçili Maili Aç
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function mapApiThread(thread: ThreadApiResponse): WorkspaceThread {
  return {
    id: thread.id,
    kind: thread.kind ?? "THREAD",
    draftId: thread.draftId ?? null,
    mailboxId: thread.mailbox?.id ?? thread.mailboxId ?? "",
    subject: thread.subject,
    snippet: thread.snippet,
    unreadCount: thread.unreadCount,
    lastMessageAt: thread.lastMessageAt,
    sender: thread.messages[0]?.fromName ?? thread.messages[0]?.fromEmail ?? "Unknown",
    latestMessageId: thread.messages[0]?.id ?? null,
    latestMessageIsRead: thread.messages[0]?.isRead ?? thread.unreadCount === 0,
    latestMessageIsSensitive: thread.messages[0]?.isSensitive ?? false,
    latestMessageIsStarred: thread.messages[0]?.isStarred ?? false,
    latestMessageIsImportant: thread.messages[0]?.isImportant ?? false,
    latestMessageState: thread.messages[0]?.state ?? null
  };
}

function parseView(value: string | null): SidebarView | null {
  if (
    value === "inbox" ||
    value === "unread" ||
    value === "starred" ||
    value === "important" ||
    value === "drafts" ||
    value === "sent" ||
    value === "trash" ||
    value === "spam" ||
    value === "archive" ||
    value === "label"
  ) {
    return value;
  }
  return null;
}

function parseReadStatus(value: string | null): ReadStatus | null {
  if (value === "all" || value === "read" || value === "unread") {
    return value;
  }
  return null;
}

function parseSortBy(value: string | null): SortBy | null {
  if (value === "date" || value === "sender") {
    return value;
  }
  return null;
}

function parseSortDirection(value: string | null): SortDirection | null {
  if (value === "asc" || value === "desc") {
    return value;
  }
  return null;
}

function parseBoolean(value: string | null): boolean | null {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function normalizeMailNotificationPreferences(input: unknown): MailNotificationPreferences {
  if (!isRecord(input)) {
    return { ...DEFAULT_MAIL_NOTIFICATION_PREFERENCES };
  }

  return {
    desktopEnabled: input.desktopEnabled === true,
    soundEnabled: input.soundEnabled === true,
    importantOnly: input.importantOnly === true,
    quietHoursEnabled: input.quietHoursEnabled === true,
    quietHoursStart: normalizeTimeValue(input.quietHoursStart),
    quietHoursEnd: normalizeTimeValue(input.quietHoursEnd, "08:00")
  };
}

function normalizeTimeValue(value: unknown, fallback = "22:00"): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (/^\d{2}:\d{2}$/.test(trimmed)) {
    const [hoursRaw, minutesRaw] = trimmed.split(":");
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
  }

  return fallback;
}

function isWithinQuietHours(date: Date, start: string, end: string): boolean {
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);

  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
    return false;
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function playNotificationSound(audioContextRef: MutableRefObject<AudioContext | null>): void {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
    return;
  }

  try {
    const context = audioContextRef.current ?? new window.AudioContext();
    audioContextRef.current = context;

    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gainNode.gain.setValueAtTime(0.0001, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.24);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.24);
  } catch {
    return;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildThreadCacheKey(input: {
  tenantId: string;
  mailboxId: string;
  view: SidebarView;
  labelId: string;
  query: string;
  readStatus: ReadStatus;
  dateFrom: string;
  dateTo: string;
  withAttachments: boolean;
  onlyStarred: boolean;
  sortBy: SortBy;
  sortDirection: SortDirection;
}): string {
  return [
    THREAD_CACHE_STORAGE_PREFIX,
    input.tenantId,
    input.mailboxId,
    input.view,
    input.labelId,
    input.query.trim().toLowerCase(),
    input.readStatus,
    input.dateFrom,
    input.dateTo,
    input.withAttachments ? "with-attachments" : "all-attachments",
    input.onlyStarred ? "starred-only" : "all-starred",
    input.sortBy,
    input.sortDirection
  ].join("|");
}

function readThreadCache(storageKey: string): {
  cachedAt: number;
  nextCursor: string | null;
  items: WorkspaceThread[];
} | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      cachedAt?: number;
      nextCursor?: string | null;
      items?: WorkspaceThread[];
    };
    if (!parsed || !Array.isArray(parsed.items) || typeof parsed.cachedAt !== "number") {
      return null;
    }
    if (Date.now() - parsed.cachedAt > THREAD_CACHE_TTL_MS) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    return {
      cachedAt: parsed.cachedAt,
      nextCursor: typeof parsed.nextCursor === "string" ? parsed.nextCursor : null,
      items: parsed.items
    };
  } catch {
    return null;
  }
}

function writeThreadCache(
  storageKey: string,
  payload: {
    cachedAt: number;
    nextCursor: string | null;
    items: WorkspaceThread[];
  }
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    return;
  }
}

function mergeThreadLists(primary: WorkspaceThread[], secondary: WorkspaceThread[]): WorkspaceThread[] {
  const map = new Map<string, WorkspaceThread>();
  for (const thread of primary) {
    map.set(thread.id, thread);
  }
  for (const thread of secondary) {
    if (!map.has(thread.id)) {
      map.set(thread.id, thread);
    }
  }
  return [...map.values()];
}
