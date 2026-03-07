import { cn } from '@/lib/utils';
import type { SelectHTMLAttributes } from 'react';

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-11 w-full rounded-[var(--radius-sm)] border border-[var(--main-border,var(--border))]',
        'bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_5%)] px-3 text-sm text-[var(--main-text,var(--text))] backdrop-blur-[var(--blur-light)]',
        'focus-visible:border-[color-mix(in_srgb,var(--primary),white_26%)] focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-[var(--focus-ring,var(--primary))] focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
