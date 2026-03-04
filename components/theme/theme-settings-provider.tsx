'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import {
  DARK_THEMES,
  DEFAULT_THEME,
  DEFAULT_APPEARANCE_SETTINGS,
  normalizeThemePreset,
  type ContrastLevelSetting,
  type FontFamilySetting,
  type FontSizeSetting,
  type LineHeightSetting,
  type SidebarDensitySetting,
  type ThemePresetName,
} from '@/lib/theme/theme-presets';
import { THEME_KEY } from '@/lib/theme/theme-storage';

const STORAGE_KEY = 'babylexit_ui_appearance_v1';
const LEGACY_THEME_KEY = 'theme';
const THEME_LOCKED_VALUE: ThemePresetName = 'pure-white';

export type DefaultMode = 'chat' | 'review' | 'research';

export interface UiAppearanceSettings {
  theme: ThemePresetName;
  fontFamily: FontFamilySetting;
  fontSize: FontSizeSetting;
  lineHeight: LineHeightSetting;
  sidebarDensity: SidebarDensitySetting;
  contrastLevel: ContrastLevelSetting;
  reduceMotion: boolean;
  highContrast: boolean;
  defaultMode: DefaultMode;
  autoSourcePanel: boolean;
}

interface ThemeSettingsContextValue {
  settings: UiAppearanceSettings;
  isClient: boolean;
  setTheme: (value: ThemePresetName) => void;
  setFontFamily: (value: FontFamilySetting) => void;
  setFontSize: (value: FontSizeSetting) => void;
  setLineHeight: (value: LineHeightSetting) => void;
  setSidebarDensity: (value: SidebarDensitySetting) => void;
  setContrastLevel: (value: ContrastLevelSetting) => void;
  setReduceMotion: (value: boolean) => void;
  setHighContrast: (value: boolean) => void;
  setDefaultMode: (value: DefaultMode) => void;
  setAutoSourcePanel: (value: boolean) => void;
  updateSettings: (value: Partial<UiAppearanceSettings>) => void;
  resetSettings: () => void;
}

const ThemeSettingsContext = createContext<ThemeSettingsContextValue | null>(null);

function readStoredSettings(): UiAppearanceSettings {
  const completeDefaultSettings: UiAppearanceSettings = {
    ...DEFAULT_APPEARANCE_SETTINGS,
    contrastLevel: DEFAULT_APPEARANCE_SETTINGS.contrastLevel,
    highContrast: DEFAULT_APPEARANCE_SETTINGS.highContrast,
    defaultMode: 'chat',
    autoSourcePanel: true,
  };

  if (typeof window === 'undefined') return completeDefaultSettings;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<UiAppearanceSettings>) : {};
    const persistedTheme = window.localStorage.getItem(THEME_KEY) ?? window.localStorage.getItem(LEGACY_THEME_KEY);

    const merged = { ...completeDefaultSettings, ...parsed };
    merged.theme = normalizeThemePreset(persistedTheme ?? parsed.theme ?? DEFAULT_THEME);

    const parsedContrastLevel: ContrastLevelSetting = parsed.contrastLevel === 'high' ? 'high' : 'normal';
    const parsedHighContrast = typeof parsed.highContrast === 'boolean' ? parsed.highContrast : undefined;
    merged.contrastLevel = parsedHighContrast || parsedContrastLevel === 'high' ? 'high' : 'normal';
    merged.highContrast = merged.contrastLevel === 'high';

    return merged;
  } catch {
    return completeDefaultSettings;
  }
}

function isThemeLockedRoute(pathname: string | null | undefined) {
  if (!pathname) return false;
  return pathname === '/editor' || pathname.startsWith('/editor/') || pathname === '/social' || pathname.startsWith('/social/');
}

function resolveThemeForPath(pathname: string | null | undefined, theme: ThemePresetName): ThemePresetName {
  if (isThemeLockedRoute(pathname)) return THEME_LOCKED_VALUE;
  return theme;
}

function applyDomAttributes(settings: UiAppearanceSettings, pathname: string | null | undefined) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const resolvedHighContrast = settings.contrastLevel === 'high' || settings.highContrast;
  const resolvedTheme = resolveThemeForPath(pathname, settings.theme);

  root.setAttribute('data-theme', resolvedTheme);
  root.setAttribute('data-font-family', settings.fontFamily);
  root.setAttribute('data-font-size', settings.fontSize);
  root.setAttribute('data-line-height', settings.lineHeight);
  root.setAttribute('data-sidebar-density', settings.sidebarDensity);
  root.setAttribute('data-contrast-level', settings.contrastLevel);
  root.setAttribute('data-reduce-motion', String(settings.reduceMotion));
  root.setAttribute('data-high-contrast', String(resolvedHighContrast));
  root.classList.toggle('dark', DARK_THEMES.includes(resolvedTheme));

  const fontSizeMap: Record<string, string> = {
    small: '14px',
    medium: '16px',
    large: '18px',
    xl: '20px',
  };
  root.style.fontSize = fontSizeMap[settings.fontSize] ?? '16px';
}

export function ThemeSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UiAppearanceSettings>(() => readStoredSettings());
  const [isClient, setIsClient] = useState(false);
  const pathname = usePathname();

  useLayoutEffect(() => {
    applyDomAttributes(settings, pathname);
  }, [settings, pathname]);

  useEffect(() => {
    setIsClient(true);
    try {
      const persistedSettings: UiAppearanceSettings = {
        ...settings,
        highContrast: settings.contrastLevel === 'high',
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedSettings));
      window.localStorage.setItem(THEME_KEY, settings.theme);
    } catch {
      // ignore
    }
  }, [settings]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY && e.key !== THEME_KEY && e.key !== LEGACY_THEME_KEY) return;
      setSettings(readStoredSettings());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const updateSettings = useCallback((value: Partial<UiAppearanceSettings>) => {
    setSettings((previous) => ({ ...previous, ...value }));
  }, []);

  const setTheme = useCallback((value: ThemePresetName) => updateSettings({ theme: value }), [updateSettings]);
  const setFontFamily = useCallback((value: FontFamilySetting) => updateSettings({ fontFamily: value }), [updateSettings]);
  const setFontSize = useCallback((value: FontSizeSetting) => updateSettings({ fontSize: value }), [updateSettings]);
  const setLineHeight = useCallback((value: LineHeightSetting) => updateSettings({ lineHeight: value }), [updateSettings]);
  const setSidebarDensity = useCallback((value: SidebarDensitySetting) => updateSettings({ sidebarDensity: value }), [updateSettings]);
  const setContrastLevel = useCallback(
    (value: ContrastLevelSetting) => updateSettings({ contrastLevel: value, highContrast: value === 'high' }),
    [updateSettings],
  );
  const setReduceMotion = useCallback((value: boolean) => updateSettings({ reduceMotion: value }), [updateSettings]);
  const setHighContrast = useCallback(
    (value: boolean) => updateSettings({ highContrast: value, contrastLevel: value ? 'high' : 'normal' }),
    [updateSettings],
  );
  const setDefaultMode = useCallback((value: DefaultMode) => updateSettings({ defaultMode: value }), [updateSettings]);
  const setAutoSourcePanel = useCallback((value: boolean) => updateSettings({ autoSourcePanel: value }), [updateSettings]);

  const resetSettings = useCallback(() => {
    setSettings({
      ...DEFAULT_APPEARANCE_SETTINGS,
      theme: DEFAULT_THEME,
      contrastLevel: DEFAULT_APPEARANCE_SETTINGS.contrastLevel,
      highContrast: DEFAULT_APPEARANCE_SETTINGS.highContrast,
      defaultMode: 'chat',
      autoSourcePanel: true,
    });
  }, []);

  const contextValue = useMemo<ThemeSettingsContextValue>(
    () => ({
      settings,
      isClient,
      setTheme,
      setFontFamily,
      setFontSize,
      setLineHeight,
      setSidebarDensity,
      setContrastLevel,
      setReduceMotion,
      setHighContrast,
      setDefaultMode,
      setAutoSourcePanel,
      updateSettings,
      resetSettings,
    }),
    [
      settings,
      setTheme,
      setFontFamily,
      setFontSize,
      setLineHeight,
      setSidebarDensity,
      setContrastLevel,
      setReduceMotion,
      setHighContrast,
      setDefaultMode,
      setAutoSourcePanel,
      updateSettings,
      resetSettings,
      isClient,
    ],
  );

  return <ThemeSettingsContext.Provider value={contextValue}>{children}</ThemeSettingsContext.Provider>;
}

export function useThemeSettings() {
  const context = useContext(ThemeSettingsContext);
  if (!context) throw new Error('useThemeSettings must be used inside ThemeSettingsProvider');
  return context;
}
