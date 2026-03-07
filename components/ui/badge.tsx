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
  blue: 'border border-[color-mix(in_srgb,var(--primary),white_55%)] bg-[color-mix(in_srgb,var(--primary),white_88%)] text-[var(--primary)]',
  orange:
    'border border-[color-mix(in_srgb,var(--warning),white_52%)] bg-[color-mix(in_srgb,var(--warning),white_88%)] text-[var(--warning)]',
  muted: 'border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),var(--border)_28%)] text-[var(--main-muted,var(--secondary))]',
  outline: 'border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_4%)] text-[var(--main-text,var(--text))]',
  success:
    'border border-[color-mix(in_srgb,var(--success),white_52%)] bg-[color-mix(in_srgb,var(--success),white_88%)] text-[var(--success)]',
  warning:
    'border border-[color-mix(in_srgb,var(--warning),white_52%)] bg-[color-mix(in_srgb,var(--warning),white_88%)] text-[var(--warning)]',
  critical:
    'border border-[color-mix(in_srgb,var(--error),white_52%)] bg-[color-mix(in_srgb,var(--error),white_89%)] text-[var(--error)]',
  'tier-1':
    'border border-[color-mix(in_srgb,var(--success),white_52%)] bg-[color-mix(in_srgb,var(--success),white_88%)] text-[var(--success)]',
  'tier-2':
    'border border-[color-mix(in_srgb,var(--primary),white_55%)] bg-[color-mix(in_srgb,var(--primary),white_88%)] text-[var(--primary)]',
  'tier-3':
    'border border-[color-mix(in_srgb,var(--accent),white_52%)] bg-[color-mix(in_srgb,var(--accent),white_88%)] text-[var(--accent)]',
  'tier-4':
    'border border-[color-mix(in_srgb,var(--warning),white_52%)] bg-[color-mix(in_srgb,var(--warning),white_88%)] text-[var(--warning)]',
};

export function Badge({ className, variant = 'muted', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.01em]',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
