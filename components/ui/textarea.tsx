import { cn } from '@/lib/utils';
import type { TextareaHTMLAttributes } from 'react';

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'flex min-h-[96px] w-full rounded-[var(--radius-sm)] px-4 py-3 text-sm',
        'border border-[var(--main-border,var(--border))]',
        'bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_4%)] text-[var(--main-text,var(--text))] backdrop-blur-[var(--blur-light)]',
        'placeholder:text-[var(--main-muted,var(--secondary))]',
        'focus-visible:border-[color-mix(in_srgb,var(--primary),white_24%)] focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-[var(--focus-ring,var(--primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
        'resize-none transition-[border-color,box-shadow] duration-200',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
