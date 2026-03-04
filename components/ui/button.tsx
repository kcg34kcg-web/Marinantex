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
    'bg-[linear-gradient(160deg,color-mix(in_srgb,var(--primary),white_10%),var(--primary))] text-white shadow-[var(--shadow-elev-2)] hover:brightness-110 hover:-translate-y-px hover:shadow-[var(--shadow-elev-3)] active:translate-y-0',
  accent:
    'bg-[linear-gradient(160deg,color-mix(in_srgb,var(--accent),white_8%),var(--accent))] text-white shadow-[var(--shadow-elev-2)] hover:brightness-110 hover:-translate-y-px hover:shadow-[var(--shadow-elev-3)] active:translate-y-0',
  outline:
    'border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] text-[var(--main-text,var(--text))] hover:bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),var(--primary)_10%)]',
  ghost:
    'bg-transparent text-[var(--main-text,var(--text))] hover:bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),var(--primary)_10%)]',
  destructive:
    'bg-[var(--error)] text-white shadow-[var(--shadow-elev-2)] hover:brightness-110 hover:-translate-y-px hover:shadow-[var(--shadow-elev-3)] active:translate-y-0',
  glass:
    'border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] text-[var(--main-text,var(--text))] backdrop-blur-[var(--blur-light)] shadow-[var(--shadow-elev-2)]',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: 'min-h-[44px] px-5 py-2.5',
  sm: 'min-h-[36px] rounded-lg px-3 py-1.5 text-xs',
  lg: 'min-h-[52px] rounded-xl px-8 py-3 text-base',
  icon: 'min-h-[44px] min-w-[44px] p-0',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex select-none items-center justify-center gap-2 rounded-xl text-sm font-medium',
          'transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring,var(--primary))] focus-visible:ring-offset-2',
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
