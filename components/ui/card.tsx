import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  glass?: boolean;
}

export function Card({ className, glass = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-md)] border transition-[box-shadow,border-color,background-color] duration-200',
        glass
          ? 'border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_8%)] shadow-[var(--shadow-elev-2)] backdrop-blur-[var(--blur-heavy)]'
          : 'border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_4%)] shadow-[var(--shadow-elev-1)] backdrop-blur-[var(--blur-light)] hover:border-[color-mix(in_srgb,var(--main-border,var(--border)),var(--primary)_22%)] hover:shadow-[var(--shadow-elev-2)]',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pb-2 md:p-6 md:pb-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-lg font-semibold leading-tight tracking-[-0.01em] text-[var(--main-text,var(--text))]', className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1 text-sm text-[var(--main-muted,var(--secondary))]', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-2 md:p-6 md:pt-2', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-3 p-5 pt-0 md:p-6 md:pt-0', className)} {...props} />;
}
