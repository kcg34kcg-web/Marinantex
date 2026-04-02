function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function parseIso(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function getStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toGoogleTimestamp(value: Date) {
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function ensureDurationEnd(startIso: string, minutes = 60) {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) {
    return null;
  }
  const end = new Date(start.getTime() + minutes * 60 * 1000);
  return end.toISOString();
}

export function detectHearingScheduledAt(metadata: unknown): string | null {
  const obj = asObject(metadata);
  const candidates = [
    getStringValue(obj.scheduledAt),
    getStringValue(obj.eventAt),
    getStringValue(obj.eventDate),
    getStringValue(obj.dateTime),
    getStringValue(obj.hearingDate),
    getStringValue(obj.hearing_at),
    getStringValue(obj.dueAt),
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    const iso = parseIso(candidate);
    if (iso) {
      return iso;
    }
  }

  return null;
}

export function isHearingLike(input: {
  eventType: string | null | undefined;
  title: string | null | undefined;
  metadata: unknown;
}): boolean {
  const metadata = asObject(input.metadata);
  const eventKind = normalizeText(getStringValue(metadata.eventKind));
  if (eventKind === 'hearing' || eventKind.includes('durusma')) {
    return true;
  }

  const eventType = normalizeText(input.eventType);
  const title = normalizeText(input.title);

  if (eventType.includes('hearing') || eventType.includes('durusma')) {
    return true;
  }
  if (title.includes('hearing') || title.includes('duruşma') || title.includes('durusma')) {
    return true;
  }

  return false;
}

export function buildGoogleCalendarLink(input: {
  title: string;
  description?: string | null;
  startIso: string;
  endIso?: string | null;
  location?: string | null;
}): string | null {
  const start = new Date(input.startIso);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  const resolvedEndIso = input.endIso ?? ensureDurationEnd(input.startIso, 60);
  const end = resolvedEndIso ? new Date(resolvedEndIso) : null;
  if (!end || Number.isNaN(end.getTime())) {
    return null;
  }

  const search = new URLSearchParams();
  search.set('action', 'TEMPLATE');
  search.set('text', input.title);
  search.set('dates', `${toGoogleTimestamp(start)}/${toGoogleTimestamp(end)}`);
  if (input.description?.trim()) {
    search.set('details', input.description.trim());
  }
  if (input.location?.trim()) {
    search.set('location', input.location.trim());
  }
  return `https://www.google.com/calendar/render?${search.toString()}`;
}

