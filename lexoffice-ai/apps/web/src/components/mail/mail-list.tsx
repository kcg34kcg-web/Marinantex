"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MailListItem, type MailListItemViewModel } from "./mail-list-item";

const ESTIMATED_ROW_HEIGHT = 132;
const OVERSCAN_ROWS = 8;

export function MailList({
  items,
  activeThreadId,
  selectedThreadIds,
  onToggleSelect,
  onToggleStar,
  onToggleImportant,
  onTogglePin,
  onActivate,
  onOpen,
  hasMore,
  loadingMore,
  loadError,
  onLoadMore
}: {
  items: MailListItemViewModel[];
  activeThreadId?: string;
  selectedThreadIds: Set<string>;
  onToggleSelect: (threadId: string) => void;
  onToggleStar: (threadId: string) => void;
  onToggleImportant: (threadId: string) => void;
  onTogglePin: (threadId: string) => void;
  onActivate: (threadId: string) => void;
  onOpen: (threadId: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadError?: string | null;
  onLoadMore: () => Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadMorePendingRef = useRef(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(720);

  const { startIndex, endIndex } = useMemo(() => {
    const visibleStart = Math.floor(scrollTop / ESTIMATED_ROW_HEIGHT);
    const visibleCount = Math.ceil(viewportHeight / ESTIMATED_ROW_HEIGHT);
    const start = Math.max(0, visibleStart - OVERSCAN_ROWS);
    const end = Math.min(items.length, visibleStart + visibleCount + OVERSCAN_ROWS);
    return {
      startIndex: start,
      endIndex: end
    };
  }, [items.length, scrollTop, viewportHeight]);

  const visibleItems = useMemo(() => items.slice(startIndex, endIndex), [endIndex, items, startIndex]);
  const topSpacerHeight = startIndex * ESTIMATED_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (items.length - endIndex) * ESTIMATED_ROW_HEIGHT);

  async function maybeLoadMore(nextScrollTop: number): Promise<void> {
    const container = containerRef.current;
    if (!container || !hasMore || loadingMore || loadMorePendingRef.current) {
      return;
    }

    const remaining = container.scrollHeight - (nextScrollTop + container.clientHeight);
    if (remaining > ESTIMATED_ROW_HEIGHT * 6) {
      return;
    }

    loadMorePendingRef.current = true;
    try {
      await onLoadMore();
    } finally {
      loadMorePendingRef.current = false;
    }
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasMore || loadingMore || loadMorePendingRef.current) {
      return;
    }

    if (container.scrollHeight > container.clientHeight + ESTIMATED_ROW_HEIGHT * 2) {
      return;
    }

    void maybeLoadMore(container.scrollTop);
  }, [hasMore, items.length, loadingMore]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-white p-6 text-center text-sm text-slate-500">
        Henüz mail yok. Mailbox bağlayıp ilk senkronizasyonu başlatın.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto bg-white"
      onScroll={(event) => {
        const nextScrollTop = event.currentTarget.scrollTop;
        setScrollTop(nextScrollTop);
        if (viewportHeight !== event.currentTarget.clientHeight) {
          setViewportHeight(event.currentTarget.clientHeight);
        }
        void maybeLoadMore(nextScrollTop);
      }}
    >
      {topSpacerHeight > 0 ? <div style={{ height: `${topSpacerHeight}px` }} /> : null}
      {visibleItems.map((item) => (
        <MailListItem
          key={item.id}
          item={item}
          active={item.id === activeThreadId}
          checked={selectedThreadIds.has(item.id)}
          onToggleChecked={onToggleSelect}
          onToggleStar={onToggleStar}
          onToggleImportant={onToggleImportant}
          onTogglePin={onTogglePin}
          onActivate={onActivate}
          onOpen={onOpen}
        />
      ))}
      {bottomSpacerHeight > 0 ? <div style={{ height: `${bottomSpacerHeight}px` }} /> : null}
      {loadingMore ? (
        <p className="px-4 py-2 text-xs text-slate-500">Daha fazla thread yükleniyor...</p>
      ) : null}
      {loadError ? (
        <div className="px-4 py-2 text-xs text-rose-700">
          <p>{loadError}</p>
          <button
            type="button"
            className="mt-1 rounded border border-rose-300 px-2 py-1"
            onClick={() => {
              void onLoadMore();
            }}
          >
            Tekrar Dene
          </button>
        </div>
      ) : null}
    </div>
  );
}
