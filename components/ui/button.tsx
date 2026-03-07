import * as React from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'default' | 'accent' | 'outline' | 'ghost' | 'destructive' | 'glass';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  default:
    'border border-transparent bg-[linear-gradient(140deg,color-mix(in_srgb,var(--primary),white_8%),var(--primary))] text-white shadow-[var(--shadow-elev-1)] hover:-translate-y-px hover:brightness-110 hover:shadow-[var(--shadow-elev-2)] active:translate-y-0 active:brightness-105',
  accent:
    'border border-transparent bg-[linear-gradient(140deg,color-mix(in_srgb,var(--accent),white_12%),var(--accent))] text-white shadow-[var(--shadow-elev-1)] hover:-translate-y-px hover:brightness-110 hover:shadow-[var(--shadow-elev-2)] active:translate-y-0 active:brightness-105',
  outline:
    'border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_6%)] text-[var(--main-text,var(--text))] shadow-[var(--shadow-elev-0)] hover:border-[color-mix(in_srgb,var(--primary),var(--main-border,var(--border))_56%)] hover:bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),var(--primary)_8%)]',
  ghost:
    'border border-transparent bg-transparent text-[var(--main-text,var(--text))] hover:bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),var(--primary)_10%)]',
  destructive:
    'border border-transparent bg-[linear-gradient(140deg,color-mix(in_srgb,var(--error),white_8%),var(--error))] text-white shadow-[var(--shadow-elev-1)] hover:-translate-y-px hover:brightness-110 hover:shadow-[var(--shadow-elev-2)] active:translate-y-0 active:brightness-105',
  glass:
    'border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),transparent_4%)] text-[var(--main-text,var(--text))] shadow-[var(--shadow-elev-1)] backdrop-blur-[var(--blur-light)] hover:border-[color-mix(in_srgb,var(--primary),var(--main-border,var(--border))_50%)] hover:bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),var(--primary)_6%)]',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: 'min-h-[44px] px-5 py-2.5',
  sm: 'min-h-[36px] rounded-[var(--radius-xs)] px-3 py-1.5 text-xs',
  lg: 'min-h-[52px] rounded-[var(--radius-md)] px-8 py-3 text-base',
  icon: 'min-h-[44px] min-w-[44px] p-0',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex select-none items-center justify-center gap-2 rounded-[var(--radius-sm)] text-sm font-semibold tracking-[0.01em]',
          'transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring,var(--primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
          'disabled:pointer-events-none disabled:opacity-50',
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
