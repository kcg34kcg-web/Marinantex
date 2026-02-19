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
    <div>
      <div className="mb-4 flex gap-2 border-b border-border pb-2">
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium',
              active === item.value ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:bg-slate-100'
            )}
            onClick={() => setActive(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div>{items.find((item) => item.value === active)?.content}</div>
    </div>
  );
}
