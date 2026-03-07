"use client";

import { useEffect, useRef } from "react";
import { MailListItem, type MailListItemViewModel } from "./mail-list-item";

export function MailList({
  items,
  activeThreadId,
  selectedThreadIds,
  onToggleSelect,
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
  onActivate: (threadId: string) => void;
  onOpen: (threadId: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadError?: string | null;
  onLoadMore: () => Promise<void>;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore || loadingMore || !sentinelRef.current) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void onLoadMore();
      }
    });

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-white p-6 text-center text-sm text-slate-500">
        Henüz mail yok. Mailbox bağlayıp ilk senkronizasyonu başlatın.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      {items.map((item) => (
        <MailListItem
          key={item.id}
          item={item}
          active={item.id === activeThreadId}
          checked={selectedThreadIds.has(item.id)}
          onToggleChecked={onToggleSelect}
          onActivate={onActivate}
          onOpen={onOpen}
        />
      ))}

      {hasMore ? <div ref={sentinelRef} className="h-8" /> : null}
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
