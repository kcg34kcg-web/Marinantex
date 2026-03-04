import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  glass?: boolean;
}

export function Card({ className, glass = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border transition-shadow duration-200',
        glass
          ? 'border-[var(--main-border,var(--border))] bg-[var(--main-surface-3,var(--surface))] shadow-[var(--shadow-elev-3)] backdrop-blur-[var(--blur-light)]'
          : 'border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] shadow-[var(--shadow-elev-2)] backdrop-blur-[var(--blur-light)] hover:shadow-[var(--shadow-elev-3)]',
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
  return <h3 className={cn('font-serif text-lg font-semibold leading-tight text-[var(--text)]', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1 text-sm text-[var(--secondary)]', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-2', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-3 p-6 pt-0', className)} {...props} />;
}
