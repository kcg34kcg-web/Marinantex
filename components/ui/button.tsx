import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// ── Fitts Kanunu: Tüm interaktif hedefler min 44×44px (Apple HIG standardı) ──────────────────────
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2',
    'rounded-xl text-sm font-medium',
    'transition-all duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-legal-action)] focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    'select-none',
  ].join(' '),
  {
    variants: {
      variant: {
        // ── Birincil CTA: Royal Blue, yumuşak gölge (hover'da yukarı kalkar)
        default:
          'bg-[var(--color-legal-action)] text-white shadow-legal-cta hover:brightness-110 hover:-translate-y-px active:translate-y-0',
        // ── Geriye dönük uyumluluk: accent (turuncu tonlar)
        accent:
          'bg-accent text-accent-foreground shadow-legal-sm hover:brightness-110 hover:-translate-y-px active:translate-y-0',
        // ── İkincil eylem: kenarlıklı, temiz
        outline:
          'border border-[var(--color-legal-border)] bg-transparent text-[var(--color-legal-primary)] hover:bg-[var(--color-legal-bg)] dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800',
        // ── Üçüncül eylem: zemin yok
        ghost:
          'bg-transparent text-[var(--color-legal-primary)] hover:bg-[var(--color-legal-bg)] dark:text-slate-200 dark:hover:bg-slate-800',
        // ── Silme / tehlike: bordo ton
        destructive:
          'bg-rose-600 text-white shadow-legal-sm hover:bg-rose-700 hover:-translate-y-px active:translate-y-0',
        // ── Glassmorphism: Cosmograph tooltip, RAG sohbet balonu için
        glass:
          'bg-white/10 dark:bg-slate-900/40 backdrop-blur-md border border-white/20 text-[var(--color-legal-primary)] dark:text-white shadow-glass hover:bg-white/20 dark:hover:bg-slate-800/60',
      },
      size: {
        default: 'min-h-[44px] px-5 py-2.5',
        sm: 'min-h-[36px] rounded-lg px-3 py-1.5 text-xs',
        lg: 'min-h-[52px] rounded-xl px-8 py-3 text-base',
        icon: 'min-h-[44px] min-w-[44px] p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Radix Slot: child elementi buton olarak render eder (Link, a vb.) */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { buttonVariants };
