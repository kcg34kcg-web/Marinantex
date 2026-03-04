'use client';

import { Palette } from 'lucide-react';
import { cn } from '@/lib/utils';
import { THEME_OPTIONS } from '@/lib/theme/theme-presets';
import { useThemeSettings } from '@/components/theme/theme-settings-provider';

interface ThemeToggleProps {
  compact?: boolean;
  className?: string;
}

export function ThemeToggle({ compact = false, className }: ThemeToggleProps) {
  const { settings, setTheme, setContrastLevel } = useThemeSettings();

  if (compact) {
    const currentIndex = THEME_OPTIONS.findIndex((item) => item.value === settings.theme);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + 1) % THEME_OPTIONS.length;
    const nextTheme = THEME_OPTIONS[nextIndex];

    return (
      <button
        type="button"
        onClick={() => setTheme(nextTheme.value)}
        title={`Temayi degistir (${settings.theme} → ${nextTheme.label})`}
        aria-label={`Temayi degistir. Siradaki tema: ${nextTheme.label}`}
        className={cn(
          // ✅ Sidebar override gerektirmeyen temiz compact buton
          'group relative grid h-10 w-10 min-h-[40px] min-w-[40px] shrink-0 place-items-center rounded-xl border p-0 leading-none',
          'transition-all duration-200',
          'border-[color-mix(in_srgb,var(--sidebar-border,var(--border)),white_10%)]',
          'bg-[color-mix(in_srgb,var(--sidebar-bg-1,var(--surface)),white_8%)]',
          'text-[var(--sidebar-text,var(--text))]',
          'shadow-[0_10px_24px_-18px_rgba(0,0,0,0.35)]',
          'hover:scale-[1.03] hover:border-[color-mix(in_srgb,var(--primary),white_15%)]',
          'hover:bg-[color-mix(in_srgb,var(--sidebar-hover,color-mix(in_srgb,var(--surface),var(--primary)_8%)),white_8%)]',
          'active:scale-[0.98]',
          className,
        )}
      >
        {/* Tema hissi glow */}
        <span className="pointer-events-none absolute inset-1 rounded-lg opacity-80 [background:radial-gradient(circle_at_30%_25%,color-mix(in_srgb,var(--primary),white_10%),transparent_55%),radial-gradient(circle_at_75%_75%,color-mix(in_srgb,var(--accent),white_10%),transparent_55%)]" />

        {/* Mini chip - dışarı taşmadan */}
        <span className="pointer-events-none absolute right-1 top-1 flex items-center gap-0.5 rounded-full border border-[color-mix(in_srgb,var(--sidebar-border,var(--border)),white_12%)] bg-[color-mix(in_srgb,var(--sidebar-bg-1,var(--surface)),white_10%)] px-1 py-0.5 shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
        </span>

        <Palette className="relative z-[1] h-4 w-4 text-[var(--primary)] transition-transform duration-200 group-hover:rotate-6" />
      </button>
    );
  }

  const nextContrastLevel = settings.contrastLevel === 'high' ? 'normal' : 'high';

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <span className="text-xs font-medium text-[var(--secondary)]">Tema</span>
      <select
        value={settings.theme}
        onChange={(event) => setTheme(event.target.value as (typeof THEME_OPTIONS)[number]['value'])}
        className={cn(
          'h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
        )}
      >
        {THEME_OPTIONS.map((theme) => (
          <option key={theme.value} value={theme.value}>
            {theme.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setContrastLevel(nextContrastLevel)}
        className={cn(
          'h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--text)]',
          'hover:bg-[color-mix(in_srgb,var(--surface),var(--accent)_10%)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring,var(--primary))]',
        )}
        title="Kontrast seviyesini degistir"
      >
        Kontrast: {settings.contrastLevel === 'high' ? 'High' : 'Normal'}
      </button>
    </div>
  );
}
