import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        // ── Mevcut varyantlar (geriye dönük uyumluluk) ────────────────────────────────────────────
        blue: 'bg-blue-100   text-blue-700   dark:bg-blue-900/40   dark:text-blue-300',
        orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
        muted: 'bg-slate-100  text-slate-700  dark:bg-slate-800     dark:text-slate-300',
        // ── Yeni semantik varyantlar ──────────────────────────────────────────────────────────────
        outline:
          'border border-[var(--color-legal-border)] bg-transparent text-[var(--color-legal-primary)] dark:text-slate-200',
        success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
        warning: 'bg-amber-100   text-amber-700   dark:bg-amber-900/40   dark:text-amber-300',
        critical: 'bg-rose-100    text-rose-700    dark:bg-rose-900/40    dark:text-rose-300',
        // ── 4 Kademeli LLM Router tier badge'leri (Adım 9 UI) ───────────────────────────────────
        'tier-1': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
        'tier-2': 'bg-blue-100    text-blue-800    dark:bg-blue-900/40    dark:text-blue-300',
        'tier-3': 'bg-violet-100  text-violet-800  dark:bg-violet-900/40  dark:text-violet-300',
        'tier-4': 'bg-amber-100   text-amber-800   dark:bg-amber-900/40   dark:text-amber-300',
      },
    },
    defaultVariants: {
      variant: 'muted',
    },
  },
);

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
