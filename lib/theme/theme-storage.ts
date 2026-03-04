import { DEFAULT_THEME, normalizeThemePreset, type ThemePresetName } from '@/lib/theme/theme-presets';

export const THEME_KEY = 'app_theme';

export function applyTheme(theme: string) {
  if (typeof document === 'undefined') return;
  const normalized = normalizeThemePreset(theme);
  document.documentElement.setAttribute('data-theme', normalized);
}

export function loadTheme(): ThemePresetName {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  return normalizeThemePreset(window.localStorage.getItem(THEME_KEY));
}

export function saveTheme(theme: string): ThemePresetName {
  const normalized = normalizeThemePreset(theme);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_KEY, normalized);
  }
  applyTheme(normalized);
  return normalized;
}

export function initTheme() {
  applyTheme(loadTheme());
}
