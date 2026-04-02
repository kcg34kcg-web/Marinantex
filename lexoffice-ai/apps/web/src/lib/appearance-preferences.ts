export type ThemePreference = "system" | "light" | "dark";
export type DensityPreference = "comfortable" | "compact";
export type MailLayoutPreference = "split" | "list";
export type MailReadingPanePosition = "right" | "bottom" | "off";

export type AppearancePreferences = {
  theme: ThemePreference;
  density: DensityPreference;
  mailLayout: MailLayoutPreference;
  mailReadingPanePosition: MailReadingPanePosition;
};

export const APPEARANCE_STORAGE_KEY = "lexoffice.appearance.preferences";
export const APPEARANCE_CHANGED_EVENT = "lexoffice:appearance-changed";

const DEFAULT_APPEARANCE: AppearancePreferences = {
  theme: "system",
  density: "comfortable",
  mailLayout: "split",
  mailReadingPanePosition: "right"
};

export function getDefaultAppearancePreferences(): AppearancePreferences {
  return { ...DEFAULT_APPEARANCE };
}

export function normalizeAppearancePreferences(input: unknown): AppearancePreferences {
  if (!isRecord(input)) {
    return getDefaultAppearancePreferences();
  }

  return {
    theme: parseThemePreference(input.theme),
    density: parseDensityPreference(input.density),
    mailLayout: parseMailLayoutPreference(input.mailLayout),
    mailReadingPanePosition: parseMailReadingPanePosition(input.mailReadingPanePosition)
  };
}

export function readAppearancePreferences(): AppearancePreferences {
  if (typeof window === "undefined") {
    return getDefaultAppearancePreferences();
  }

  const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  if (!raw) {
    return getDefaultAppearancePreferences();
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeAppearancePreferences(parsed);
  } catch {
    return getDefaultAppearancePreferences();
  }
}

export function writeAppearancePreferences(preferences: AppearancePreferences): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalized = normalizeAppearancePreferences(preferences);
  window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalized));
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "light" || preference === "dark") {
    return preference;
  }

  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

export function applyAppearancePreferences(preferences: AppearancePreferences): void {
  if (typeof document === "undefined") {
    return;
  }

  const normalized = normalizeAppearancePreferences(preferences);
  const resolvedTheme = resolveTheme(normalized.theme);
  const root = document.documentElement;

  root.dataset.themePreference = normalized.theme;
  root.dataset.theme = resolvedTheme;
  root.dataset.density = normalized.density;
  root.dataset.mailLayout = normalized.mailLayout;
  root.dataset.mailReadingPanePosition = normalized.mailReadingPanePosition;
  root.classList.toggle("dark", resolvedTheme === "dark");
}

function parseThemePreference(value: unknown): ThemePreference {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return DEFAULT_APPEARANCE.theme;
}

function parseDensityPreference(value: unknown): DensityPreference {
  if (value === "compact" || value === "comfortable") {
    return value;
  }
  return DEFAULT_APPEARANCE.density;
}

function parseMailLayoutPreference(value: unknown): MailLayoutPreference {
  if (value === "split" || value === "list") {
    return value;
  }
  return DEFAULT_APPEARANCE.mailLayout;
}

function parseMailReadingPanePosition(value: unknown): MailReadingPanePosition {
  if (value === "right" || value === "bottom" || value === "off") {
    return value;
  }
  return DEFAULT_APPEARANCE.mailReadingPanePosition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
