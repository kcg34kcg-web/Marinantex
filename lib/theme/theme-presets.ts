export const THEME_PRESETS = {
  'dark-mode': {
    label: 'Dark Mode',
    primary: '#8FB3FF',
    secondary: '#9CA9C8',
    bg: '#0B1220',
    surface: '#111A2E',
    text: '#E8EEFF',
    border: '#24314C',
    accent: '#54C8BE',
    success: '#42C08E',
    warning: '#D8A85B',
    error: '#E37D85',
    backgroundAsset: 'NONE',
    backgroundAltAsset: 'NONE',
  },
  'light-mode': {
    label: 'Light Mode',
    primary: '#1F64D8',
    secondary: '#64748B',
    bg: '#F4F7FC',
    surface: '#FFFFFF',
    text: '#101A2B',
    border: '#D8E1F0',
    accent: '#0FA89C',
    success: '#1E9F6F',
    warning: '#B6782D',
    error: '#C2505B',
    backgroundAsset: 'NONE',
    backgroundAltAsset: 'NONE',
  },
  'young-mode': {
    label: 'Young Mode',
    primary: '#2563FF',
    secondary: '#576187',
    bg: '#F1F5FF',
    surface: '#FFFFFF',
    text: '#141B3A',
    border: '#CCD7FF',
    accent: '#FF6B8F',
    success: '#0AA06E',
    warning: '#C2852E',
    error: '#D4475D',
    backgroundAsset: 'NONE',
    backgroundAltAsset: 'NONE',
  },
  'reading-mode': {
    label: 'Reading Mode',
    primary: '#6D5B3B',
    secondary: '#746854',
    bg: '#F8F1E3',
    surface: '#FCF7EC',
    text: '#2F2418',
    border: '#E2D5BF',
    accent: '#9A8057',
    success: '#4D865C',
    warning: '#A16B2F',
    error: '#A45252',
    backgroundAsset: 'NONE',
    backgroundAltAsset: 'NONE',
  },
} as const;

export type ThemePresetName = keyof typeof THEME_PRESETS;

const THEME_ALIASES: Record<string, ThemePresetName> = {
  dark: 'dark-mode',
  light: 'light-mode',
  young: 'young-mode',
  reading: 'reading-mode',
  natureCalm: 'light-mode',
  modernCitrus: 'young-mode',
  warmPro: 'reading-mode',
  youthPop: 'young-mode',
  luxAggressive: 'dark-mode',
  aquaWave: 'light-mode',
  roseDream: 'young-mode',
  graphiteDark: 'dark-mode',
  neoContrast: 'young-mode',
  pureWhite: 'light-mode',
  'nature-calm': 'light-mode',
  'modern-citrus': 'young-mode',
  'warm-pro': 'reading-mode',
  'youth-pop': 'young-mode',
  'lux-aggressive': 'dark-mode',
  'aqua-wave': 'light-mode',
  'rose-dream': 'young-mode',
  'graphite-dark': 'dark-mode',
  'neo-contrast': 'young-mode',
  'ocean-cliff': 'dark-mode',
  'emerald-bridge': 'light-mode',
  'starlit-lake': 'dark-mode',
  'azure-cove': 'young-mode',
  'alpine-reflection': 'light-mode',
  'magenta-sunset': 'young-mode',
  'pure-white': 'reading-mode',
};

export const DEFAULT_THEME: ThemePresetName = 'light-mode';

export function normalizeThemePreset(value: string | null | undefined): ThemePresetName {
  if (!value) return DEFAULT_THEME;
  if (value in THEME_PRESETS) return value as ThemePresetName;
  return THEME_ALIASES[value] ?? DEFAULT_THEME;
}

export type FontFamilySetting =
  | 'inter'
  | 'system'
  | 'legalSans'
  | 'serif'
  | 'modernSans'
  | 'mono';

export type FontSizeSetting = 'small' | 'medium' | 'large' | 'xl';
export type LineHeightSetting = 'compact' | 'normal' | 'relaxed';
export type SidebarDensitySetting = 'comfortable' | 'normal' | 'compact';
export type ContrastLevelSetting = 'normal' | 'high';

export interface UiAppearanceSettings {
  theme: ThemePresetName;
  fontFamily: FontFamilySetting;
  fontSize: FontSizeSetting;
  lineHeight: LineHeightSetting;
  sidebarDensity: SidebarDensitySetting;
  contrastLevel: ContrastLevelSetting;
  reduceMotion: boolean;
  highContrast: boolean;
}

export const DEFAULT_APPEARANCE_SETTINGS: UiAppearanceSettings = {
  theme: DEFAULT_THEME,
  fontFamily: 'inter',
  fontSize: 'medium',
  lineHeight: 'normal',
  sidebarDensity: 'normal',
  contrastLevel: 'normal',
  reduceMotion: false,
  highContrast: false,
};

export const DARK_THEMES: ThemePresetName[] = ['dark-mode'];

export const THEME_OPTIONS: Array<{ value: ThemePresetName; label: string }> = [
  { value: 'light-mode', label: 'Light Mode' },
  { value: 'dark-mode', label: 'Dark Mode' },
  { value: 'young-mode', label: 'Young Mode' },
  { value: 'reading-mode', label: 'Reading Mode' },
];

export const FONT_FAMILY_OPTIONS: Array<{ value: FontFamilySetting; label: string }> = [
  { value: 'inter', label: 'Manrope' },
  { value: 'system', label: 'System UI' },
  { value: 'legalSans', label: 'IBM Plex / Legal' },
  { value: 'serif', label: 'Source Serif 4' },
  { value: 'modernSans', label: 'Modern Sans' },
  { value: 'mono', label: 'Monospace' },
];

export const FONT_SIZE_OPTIONS: Array<{ value: FontSizeSetting; label: string }> = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'xl', label: 'XL' },
];

export const LINE_HEIGHT_OPTIONS: Array<{ value: LineHeightSetting; label: string }> = [
  { value: 'compact', label: 'Compact' },
  { value: 'normal', label: 'Normal' },
  { value: 'relaxed', label: 'Relaxed' },
];

export const SIDEBAR_DENSITY_OPTIONS: Array<{ value: SidebarDensitySetting; label: string }> = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'normal', label: 'Normal' },
  { value: 'compact', label: 'Compact' },
];

export const CONTRAST_LEVEL_OPTIONS: Array<{ value: ContrastLevelSetting; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
];
