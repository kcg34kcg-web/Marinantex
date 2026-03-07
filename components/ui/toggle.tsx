import { cn } from '@/lib/utils';

interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Toggle({ checked, onCheckedChange, disabled = false, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 items-center rounded-full border transition-colors duration-200',
        checked
          ? 'border-[color-mix(in_srgb,var(--primary),white_24%)] bg-[color-mix(in_srgb,var(--primary),white_8%)]'
          : 'border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),var(--border)_36%)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow-[var(--shadow-elev-0)] transition-transform duration-200',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}
