'use client';

import { useEffect, useState } from 'react';
import { Palette } from 'lucide-react';
import { cn } from '@/lib/utils';
import { THEME_KEY } from '@/lib/theme/theme-storage';
import {
  DEFAULT_THEME,
  normalizeThemePreset,
  type ThemePresetName,
} from '@/lib/theme/theme-presets';

type ThemePaletteButtonProps = {
  className?: string;
};

const THEME_ORDER = [
  'ocean-cliff',
  'emerald-bridge',
  'starlit-lake',
  'azure-cove',
  'alpine-reflection',
  'magenta-sunset',
  'pure-white',
] as const;

type ThemeId = (typeof THEME_ORDER)[number];

function isKnownTheme(value: string | null | undefined): value is ThemeId {
  return !!value && THEME_ORDER.includes(value as ThemeId);
}

function readTheme(): ThemeId {
  if (typeof window === 'undefined') return THEME_ORDER[0];

  const datasetTheme = document.documentElement.dataset.theme;
  if (isKnownTheme(datasetTheme)) return datasetTheme as ThemeId;

  const stored = normalizeThemePreset(localStorage.getItem(THEME_KEY) ?? localStorage.getItem('theme'));
  if (isKnownTheme(stored)) return stored as ThemeId;

  return THEME_ORDER[0];
}

function writeTheme(theme: ThemeId) {
  if (typeof window === 'undefined') return;

  const normalized = normalizeThemePreset(theme) as ThemePresetName;
  document.documentElement.dataset.theme = normalized;
  localStorage.setItem(THEME_KEY, normalized);
  localStorage.setItem('theme', normalized);
  window.dispatchEvent(new CustomEvent('ui-theme-changed', { detail: { theme: normalized } }));
}

function getNextTheme(current: ThemeId): ThemeId {
  const index = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length];
}

export function ThemePaletteButton({ className }: ThemePaletteButtonProps) {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME as ThemeId);

  useEffect(() => {
    setTheme(readTheme());

    const onThemeChanged = (e: Event) => {
      const custom = e as CustomEvent<{ theme?: string }>;
      const next = custom.detail?.theme;
      if (isKnownTheme(next)) setTheme(next);
      else setTheme(readTheme());
    };

    window.addEventListener('ui-theme-changed', onThemeChanged);
    return () => window.removeEventListener('ui-theme-changed', onThemeChanged);
  }, []);

  const handleCycleTheme = () => {
    setTheme((prev) => {
      const current = isKnownTheme(prev) ? prev : readTheme();
      const next = getNextTheme(current);
      writeTheme(next);
      return next;
    });
  };

  const nextThemeLabel = getNextTheme(theme);

  return (
    <button
      type="button"
      onClick={handleCycleTheme}
      title={`Temayi degistir (sonraki: ${nextThemeLabel})`}
      aria-label={`Temayi degistir. Siradaki tema: ${nextThemeLabel}`}
      className={cn(
        // ✅ Tam merkez + simetrik
        'group relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border leading-none',
        'transition-all duration-200',
        'border-[color-mix(in_srgb,var(--sidebar-border,var(--border)),white_10%)]',
        'bg-[color-mix(in_srgb,var(--sidebar-bg-1,var(--surface)),white_8%)]',
        'text-[var(--sidebar-text,var(--text))]',
        'hover:scale-[1.03] hover:border-[color-mix(in_srgb,var(--primary),white_15%)]',
        'hover:bg-[color-mix(in_srgb,var(--sidebar-hover,color-mix(in_srgb,var(--surface),var(--primary)_8%)),white_8%)]',
        'active:scale-[0.98]',
        'shadow-[0_10px_24px_-18px_rgba(0,0,0,0.35)]',
        className
      )}
    >
      {/* Seçili temaya göre görsel renk hissi */}
      <span className="pointer-events-none absolute inset-1 rounded-lg opacity-80 [background:radial-gradient(circle_at_30%_25%,color-mix(in_srgb,var(--primary),white_10%),transparent_55%),radial-gradient(circle_at_75%_75%,color-mix(in_srgb,var(--accent),white_10%),transparent_55%)]" />

      {/* ✅ Chip artık dışarı taşmıyor -> görsel denge ortalanıyor */}
      <span className="pointer-events-none absolute right-1 top-1 flex items-center gap-0.5 rounded-full border border-[color-mix(in_srgb,var(--sidebar-border,var(--border)),white_12%)] bg-[color-mix(in_srgb,var(--sidebar-bg-1,var(--surface)),white_10%)] px-1 py-0.5 shadow-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
      </span>

      <Palette className="relative z-[1] h-4 w-4 text-[var(--primary)] transition-transform duration-200 group-hover:rotate-6" />
    </button>
  );
}
