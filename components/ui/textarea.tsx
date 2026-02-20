import { cn } from '@/lib/utils';
import type { TextareaHTMLAttributes } from 'react';

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-xl px-4 py-3 text-sm',
        'bg-[var(--color-legal-surface)] text-[var(--color-legal-primary)]',
        'border border-[var(--color-legal-border)]',
        'placeholder:text-[var(--color-legal-text-secondary,_var(--muted-foreground))]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-legal-action)] focus-visible:ring-offset-2',
        'transition-shadow duration-200 resize-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
