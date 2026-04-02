'use client';

import type { AssistantQuickActionItem } from '@/types/assistant';

interface QuickActionsProps {
  items: AssistantQuickActionItem[];
  disabled?: boolean;
  onSelect: (item: AssistantQuickActionItem) => void;
}

export function QuickActions({ items, disabled, onSelect }: QuickActionsProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 px-3 pb-2">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(item)}
          className="inline-flex items-center rounded-full border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-1,var(--surface)),white_10%)] px-3 py-1 text-xs text-[var(--main-text,var(--text))] transition-colors hover:bg-[color-mix(in_srgb,var(--main-surface-1,var(--surface)),black_4%)] disabled:opacity-60"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
