"use client";

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  items: TabItem[];
}

export function Tabs({ items }: TabsProps) {
  const [active, setActive] = useState(items[0]?.value ?? '');

  return (
    <div className="space-y-4">
      <div className="inline-flex w-full flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),transparent_6%)] p-1.5">
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            className={cn(
              'rounded-[calc(var(--radius-sm)-4px)] px-3 py-2 text-sm font-medium transition-all duration-200',
              active === item.value
                ? 'bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary),white_10%),var(--primary))] text-white shadow-[var(--shadow-elev-0)]'
                : 'text-[var(--main-muted,var(--secondary))] hover:bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),var(--primary)_10%)] hover:text-[var(--main-text,var(--text))]'
            )}
            onClick={() => setActive(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="animate-fade-in">{items.find((item) => item.value === active)?.content}</div>
    </div>
  );
}
