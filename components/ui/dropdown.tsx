import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface DropdownProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function Dropdown({ label, children, className }: DropdownProps) {
  return (
    <details className={cn('relative', className)}>
      <summary className="inline-flex min-h-[40px] cursor-pointer list-none items-center rounded-[var(--radius-sm)] border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_5%)] px-3 py-2 text-sm font-medium text-[var(--main-text,var(--text))] shadow-[var(--shadow-elev-0)]">
        {label}
      </summary>
      <div className="absolute right-0 z-20 mt-2 min-w-[180px] rounded-[var(--radius-sm)] border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_2%)] p-2 shadow-[var(--shadow-elev-2)] backdrop-blur-[var(--blur-light)]">
        {children}
      </div>
    </details>
  );
}
