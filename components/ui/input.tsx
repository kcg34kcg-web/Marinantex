import { cn } from '@/lib/utils';
import type { InputHTMLAttributes } from 'react';

// ── Fitts Kanunu: min 44px dokunmatik hedef alanı ────────────────────────────────────────────────
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'flex min-h-[44px] w-full rounded-[var(--radius-sm)] px-4 py-2.5 text-sm',
        'border border-[var(--main-border,var(--border))]',
        'bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_5%)] text-[var(--main-text,var(--text))] backdrop-blur-[var(--blur-light)]',
        'placeholder:text-[var(--main-muted,var(--secondary))]',
        'focus-visible:border-[color-mix(in_srgb,var(--primary),white_26%)] focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-[var(--focus-ring,var(--primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
        'transition-[border-color,box-shadow,background-color] duration-200',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  );
}
