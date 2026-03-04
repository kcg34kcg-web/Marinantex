import * as React from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant =
  | 'blue'
  | 'orange'
  | 'muted'
  | 'outline'
  | 'success'
  | 'warning'
  | 'critical'
  | 'tier-1'
  | 'tier-2'
  | 'tier-3'
  | 'tier-4';

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  blue: 'bg-[color-mix(in_srgb,var(--primary),white_86%)] text-[var(--primary)]',
  orange: 'bg-[color-mix(in_srgb,var(--warning),white_86%)] text-[var(--warning)]',
  muted: 'bg-[color-mix(in_srgb,var(--border),white_45%)] text-[var(--secondary)]',
  outline: 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]',
  success: 'bg-[color-mix(in_srgb,var(--success),white_86%)] text-[var(--success)]',
  warning: 'bg-[color-mix(in_srgb,var(--warning),white_86%)] text-[var(--warning)]',
  critical: 'bg-[color-mix(in_srgb,var(--error),white_87%)] text-[var(--error)]',
  'tier-1': 'bg-[color-mix(in_srgb,var(--success),white_86%)] text-[var(--success)]',
  'tier-2': 'bg-[color-mix(in_srgb,var(--primary),white_86%)] text-[var(--primary)]',
  'tier-3': 'bg-[color-mix(in_srgb,var(--accent),white_86%)] text-[var(--accent)]',
  'tier-4': 'bg-[color-mix(in_srgb,var(--warning),white_86%)] text-[var(--warning)]',
};

export function Badge({ className, variant = 'muted', ...props }: BadgeProps) {
  return (
    <div
      className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', variantClasses[variant], className)}
      {...props}
    />
  );
}
