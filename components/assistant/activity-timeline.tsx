'use client';

import type { AssistantAuditLogItem } from '@/types/assistant';

interface ActivityTimelineProps {
  items: AssistantAuditLogItem[];
}

export function ActivityTimeline({ items }: ActivityTimelineProps) {
  return (
    <div className="space-y-2 p-3">
      {items.map((item) => (
        <div key={item.id} className="rounded-xl border border-[var(--main-border,var(--border))] p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--main-muted,var(--secondary))]">{item.category}</span>
            <span className="text-[10px] text-[var(--main-muted,var(--secondary))]">
              {new Date(item.createdAt).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
            </span>
          </div>
          <p className="text-xs text-[var(--main-text,var(--text))]">{item.summary}</p>
        </div>
      ))}
      {items.length === 0 ? (
        <p className="text-xs text-[var(--main-muted,var(--secondary))]">Henüz işlem kaydı yok.</p>
      ) : null}
    </div>
  );
}
