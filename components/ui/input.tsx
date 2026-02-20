import { cn } from '@/lib/utils';
import type { InputHTMLAttributes } from 'react';

// ── Fitts Kanunu: min 44px dokunmatik hedef alanı ────────────────────────────────────────────────
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'flex min-h-[44px] w-full rounded-xl px-4 py-2.5 text-sm',
        'bg-[var(--color-legal-surface)] text-[var(--color-legal-primary)]',
        'border border-[var(--color-legal-border)]',
        'placeholder:text-[var(--color-legal-text-secondary,_var(--muted-foreground))]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-legal-action)] focus-visible:ring-offset-2',
        'transition-shadow duration-200',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  );
}
