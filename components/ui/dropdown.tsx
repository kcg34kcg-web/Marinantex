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
      <summary className="inline-flex cursor-pointer list-none items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]">
        {label}
      </summary>
      <div className="absolute right-0 z-20 mt-2 min-w-[180px] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl">
        {children}
      </div>
    </details>
  );
}
