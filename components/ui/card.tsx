import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Glassmorphism: Cosmograph tooltipler, RAG sohbet balonları */
  glass?: boolean;
}

// ── rounded-2xl: Shadcn stratejik modifikasyonu — sert köşe hatları kalktı ───────────────────────
export function Card({ className, glass = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border transition-shadow duration-200',
        glass
          ? 'bg-white/10 dark:bg-slate-900/40 backdrop-blur-md border-white/20 shadow-glass'
          : 'bg-[var(--color-legal-surface)] border-[var(--color-legal-border)] shadow-legal-sm hover:shadow-legal-md',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pb-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-lg font-semibold leading-tight text-[var(--color-legal-primary)] font-serif', className)}
      {...props}
    />
  );
}

/** Yeni: Başlık altındaki yardımcı açıklama metni */
export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('text-sm text-[var(--color-legal-text-secondary,_var(--muted-foreground))] mt-1', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-2', className)} {...props} />;
}

/** Yeni: Kart alt eylem alanı */
export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-3 p-6 pt-0', className)} {...props} />;
}
