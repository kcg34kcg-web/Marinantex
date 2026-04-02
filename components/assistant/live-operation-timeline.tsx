'use client';

import { cn } from '@/lib/utils';
import type { AssistantLiveTimelineItem } from '@/types/assistant';

interface LiveOperationTimelineProps {
  items: AssistantLiveTimelineItem[];
}

function statusClass(status: AssistantLiveTimelineItem['status']) {
  if (status === 'done') return 'border-emerald-300/70 bg-emerald-50 text-emerald-700';
  if (status === 'error') return 'border-rose-300/70 bg-rose-50 text-rose-700';
  if (status === 'running') return 'border-blue-300/70 bg-blue-50 text-blue-700';
  return 'border-slate-300/70 bg-slate-50 text-slate-600';
}

export function LiveOperationTimeline({ items }: LiveOperationTimelineProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mx-3 mt-2 rounded-xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] p-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--main-muted,var(--secondary))]">Şimdi ne yapıyorum?</p>
      <div className="space-y-1.5">
        {items.slice(-4).map((item) => (
          <div key={item.id} className="flex items-start gap-2">
            <span className={cn('mt-0.5 inline-flex h-2.5 w-2.5 rounded-full border', statusClass(item.status))} />
            <div className="min-w-0">
              <p className="truncate text-[11px] text-[var(--main-text,var(--text))]">{item.step}</p>
              {item.detail ? <p className="truncate text-[10px] text-[var(--main-muted,var(--secondary))]">{item.detail}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
