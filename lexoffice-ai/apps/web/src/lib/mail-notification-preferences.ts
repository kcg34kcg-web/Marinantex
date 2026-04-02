export type MailNotificationPreferences = {
  desktopEnabled: boolean;
  soundEnabled: boolean;
  importantOnly: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
};

export const MAIL_NOTIFICATION_PREFS_STORAGE_KEY = "lexoffice.mail.notification-preferences";
export const MAIL_NOTIFICATION_CHANGED_EVENT = "lexoffice:mail-notification-changed";

const DEFAULT_MAIL_NOTIFICATION_PREFERENCES: MailNotificationPreferences = {
  desktopEnabled: false,
  soundEnabled: false,
  importantOnly: false,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00"
};

export function getDefaultMailNotificationPreferences(): MailNotificationPreferences {
  return { ...DEFAULT_MAIL_NOTIFICATION_PREFERENCES };
}

export function normalizeMailNotificationPreferences(input: unknown): MailNotificationPreferences {
  if (!isRecord(input)) {
    return getDefaultMailNotificationPreferences();
  }

  return {
    desktopEnabled: input.desktopEnabled === true,
    soundEnabled: input.soundEnabled === true,
    importantOnly: input.importantOnly === true,
    quietHoursEnabled: input.quietHoursEnabled === true,
    quietHoursStart: normalizeTimeValue(input.quietHoursStart),
    quietHoursEnd: normalizeTimeValue(input.quietHoursEnd, "08:00")
  };
}

export function readMailNotificationPreferences(): MailNotificationPreferences {
  if (typeof window === "undefined") {
    return getDefaultMailNotificationPreferences();
  }

  const raw = window.localStorage.getItem(MAIL_NOTIFICATION_PREFS_STORAGE_KEY);
  if (!raw) {
    const legacyDesktop = window.localStorage.getItem("mail.desktopNotifications.enabled") === "true";
    return {
      ...getDefaultMailNotificationPreferences(),
      desktopEnabled: legacyDesktop
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeMailNotificationPreferences(parsed);
  } catch {
    return getDefaultMailNotificationPreferences();
  }
}

export function writeMailNotificationPreferences(
  preferences: MailNotificationPreferences
): MailNotificationPreferences {
  const normalized = normalizeMailNotificationPreferences(preferences);

  if (typeof window === "undefined") {
    return normalized;
  }

  window.localStorage.setItem(MAIL_NOTIFICATION_PREFS_STORAGE_KEY, JSON.stringify(normalized));
  window.localStorage.setItem("mail.desktopNotifications.enabled", normalized.desktopEnabled ? "true" : "false");
  return normalized;
}

function normalizeTimeValue(value: unknown, fallback = "22:00"): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  const match = /^(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return fallback;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
