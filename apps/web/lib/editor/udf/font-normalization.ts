const KNOWN_FONT_MAP: Record<string, string> = {
  "times new roman": "'Times New Roman', Times, serif",
  times: "'Times New Roman', Times, serif",
  georgia: "Georgia, serif",
  garamond: "Garamond, serif",
  calibri: "Calibri, 'Segoe UI', sans-serif",
  cambria: "Cambria, Georgia, serif",
  arial: "Arial, Helvetica, sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
  verdana: "Verdana, Geneva, sans-serif",
  tahoma: "Tahoma, Geneva, sans-serif",
  "trebuchet ms": "'Trebuchet MS', sans-serif",
  "book antiqua": "'Book Antiqua', Palatino, serif",
  palatino: "'Palatino Linotype', 'Book Antiqua', Palatino, serif",
  "courier new": "'Courier New', Courier, monospace",
  "lucida sans": "'Lucida Sans Unicode', 'Lucida Grande', sans-serif",
  "segoe ui": "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
  roboto: "Roboto, Arial, sans-serif",
  inter: "Inter, 'Segoe UI', sans-serif",
  serif: "'Times New Roman', Times, serif",
  "sans serif": "Arial, Helvetica, sans-serif",
  sans: "Arial, Helvetica, sans-serif",
  monospace: "'Courier New', Courier, monospace",
};

const DEFAULT_FONT_FAMILY = "'Times New Roman', Times, serif";

function normalizeKey(value: string): string {
  return value
    .replaceAll(/['"]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr");
}

function firstFamily(value: string): string {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[0] ?? "";
}

export interface NormalizedFontResult {
  normalized: string;
  changed: boolean;
  reason?: string;
}

export function normalizeFontFamily(raw?: string | null): NormalizedFontResult {
  const safeRaw = (raw ?? "").trim();
  if (!safeRaw) {
    return {
      normalized: DEFAULT_FONT_FAMILY,
      changed: false,
    };
  }

  const direct = KNOWN_FONT_MAP[normalizeKey(safeRaw)];
  if (direct) {
    return {
      normalized: direct,
      changed: direct !== safeRaw,
      reason: direct !== safeRaw ? "normalized-family" : undefined,
    };
  }

  const first = firstFamily(safeRaw);
  const fromFirst = first ? KNOWN_FONT_MAP[normalizeKey(first)] : undefined;
  if (fromFirst) {
    return {
      normalized: fromFirst,
      changed: fromFirst !== safeRaw,
      reason: "first-family-match",
    };
  }

  return {
    normalized: DEFAULT_FONT_FAMILY,
    changed: true,
    reason: "unsupported-family",
  };
}

export function defaultFontFamily(): string {
  return DEFAULT_FONT_FAMILY;
}
