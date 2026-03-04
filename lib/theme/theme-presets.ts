export const THEME_PRESETS = {
  'ocean-cliff': {
    label: 'Ocean Cliff',
    primary: '#2A7FA6',
    secondary: '#A9C5D4',
    bg: '#091A23',
    surface: '#0F2735',
    text: '#F3FAFF',
    border: '#5D90AB',
    accent: '#56D4C5',
    success: '#39C698',
    warning: '#E5B55F',
    error: '#E97575',
    backgroundAsset: 'BG01',
    backgroundAltAsset: 'BG07',
  },
  'emerald-bridge': {
    label: 'Emerald Bridge',
    primary: '#2C8A8F',
    secondary: '#A8C9C3',
    bg: '#0E1B1A',
    surface: '#14302D',
    text: '#F2FDFB',
    border: '#5A918A',
    accent: '#64D9B7',
    success: '#46C88D',
    warning: '#D4AF6C',
    error: '#E67E76',
    backgroundAsset: 'BG02',
    backgroundAltAsset: 'BG05',
  },
  'starlit-lake': {
    label: 'Starlit Lake',
    primary: '#6FA9D8',
    secondary: '#B4C3DB',
    bg: '#060B14',
    surface: '#0C1630',
    text: '#F1F5FF',
    border: '#4C628A',
    accent: '#78E1D6',
    success: '#3ABF99',
    warning: '#CDAE69',
    error: '#E78691',
    backgroundAsset: 'BG03',
    backgroundAltAsset: 'BG10',
  },
  'azure-cove': {
    label: 'Azure Cove',
    primary: '#2F88C8',
    secondary: '#9CC1D9',
    bg: '#0D2233',
    surface: '#17354A',
    text: '#F4FAFF',
    border: '#5F96BC',
    accent: '#54D2C8',
    success: '#39C295',
    warning: '#D8B96E',
    error: '#E67676',
    backgroundAsset: 'BG04',
    backgroundAltAsset: 'BG09',
  },
  'alpine-reflection': {
    label: 'Alpine Reflection',
    primary: '#4F86A9',
    secondary: '#AFC0CA',
    bg: '#0D1A24',
    surface: '#152736',
    text: '#F2F8FC',
    border: '#607E92',
    accent: '#5FD0C4',
    success: '#42C497',
    warning: '#D4B26A',
    error: '#E27B7B',
    backgroundAsset: 'BG06',
    backgroundAltAsset: 'BG10',
  },
  'magenta-sunset': {
    label: 'Magenta Sunset',
    primary: '#8B6EC7',
    secondary: '#C3B6D8',
    bg: '#140A1E',
    surface: '#251339',
    text: '#FFF4FF',
    border: '#7D689A',
    accent: '#66D0D8',
    success: '#43C69B',
    warning: '#D6B570',
    error: '#E67EA0',
    backgroundAsset: 'BG08',
    backgroundAltAsset: 'BG07',
  },
  'pure-white': {
    label: 'Pure White',
    primary: '#1F4E8E',
    secondary: '#6B7280',
    bg: '#F7FAFC',
    surface: '#FFFFFF',
    text: '#0F172A',
    border: '#D7DEE8',
    accent: '#2A9FB2',
    success: '#1E8A5B',
    warning: '#A9732A',
    error: '#B94C4C',
    backgroundAsset: 'NONE',
    backgroundAltAsset: 'NONE',
  },
} as const;

export type ThemePresetName = keyof typeof THEME_PRESETS;

const THEME_ALIASES: Record<string, ThemePresetName> = {
  natureCalm: 'ocean-cliff',
  modernCitrus: 'azure-cove',
  warmPro: 'emerald-bridge',
  youthPop: 'azure-cove',
  luxAggressive: 'starlit-lake',
  aquaWave: 'alpine-reflection',
  roseDream: 'magenta-sunset',
  graphiteDark: 'starlit-lake',
  neoContrast: 'azure-cove',
  pureWhite: 'pure-white',
  'nature-calm': 'ocean-cliff',
  'modern-citrus': 'azure-cove',
  'warm-pro': 'emerald-bridge',
  'youth-pop': 'azure-cove',
  'lux-aggressive': 'starlit-lake',
  'aqua-wave': 'alpine-reflection',
  'rose-dream': 'magenta-sunset',
  'graphite-dark': 'starlit-lake',
  'neo-contrast': 'azure-cove',
};

export const DEFAULT_THEME: ThemePresetName = 'ocean-cliff';

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

export const DARK_THEMES: ThemePresetName[] = ['starlit-lake', 'magenta-sunset'];

export const THEME_OPTIONS: Array<{ value: ThemePresetName; label: string }> = [
  { value: 'ocean-cliff', label: 'Ocean Cliff' },
  { value: 'emerald-bridge', label: 'Emerald Bridge' },
  { value: 'starlit-lake', label: 'Starlit Lake' },
  { value: 'azure-cove', label: 'Azure Cove' },
  { value: 'alpine-reflection', label: 'Alpine Reflection' },
  { value: 'magenta-sunset', label: 'Magenta Sunset' },
  { value: 'pure-white', label: 'Pure White' },
];

export const FONT_FAMILY_OPTIONS: Array<{ value: FontFamilySetting; label: string }> = [
  { value: 'inter', label: 'Inter' },
  { value: 'system', label: 'System UI' },
  { value: 'legalSans', label: 'Source Sans / Legal' },
  { value: 'serif', label: 'Playfair Serif' },
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
