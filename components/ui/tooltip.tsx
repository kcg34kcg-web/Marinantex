import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <span className={cn('group relative inline-flex', className)}>
      {children}
      <span className="pointer-events-none absolute -top-9 left-1/2 z-30 hidden -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-xs)] border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_4%)] px-2 py-1 text-[11px] text-[var(--main-text,var(--text))] shadow-[var(--shadow-elev-1)] backdrop-blur-[var(--blur-light)] group-hover:block">
        {content}
      </span>
    </span>
  );
}
