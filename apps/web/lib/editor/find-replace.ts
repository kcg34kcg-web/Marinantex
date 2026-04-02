export interface ReplaceRange {
  from: number;
  to: number;
}

export interface MatchWindow {
  from: number;
  to: number;
}

export interface FindOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  locale?: string;
}

const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

export function toSafeReplaceRanges(ranges: ReplaceRange[]): ReplaceRange[] {
  const normalized = ranges
    .filter((item) => isFiniteInteger(item.from) && isFiniteInteger(item.to) && item.from >= 1 && item.to > item.from)
    .sort((a, b) => {
      if (a.from === b.from) {
        return b.to - a.to;
      }
      return b.from - a.from;
    });

  const safe: ReplaceRange[] = [];
  let previousFrom = Number.POSITIVE_INFINITY;

  normalized.forEach((item) => {
    if (item.to <= previousFrom) {
      safe.push(item);
      previousFrom = item.from;
    }
  });

  return safe;
}

function isWordChar(value: string): boolean {
  if (!value) return false;
  return WORD_CHAR_RE.test(value);
}

export function findTextMatchRanges(
  text: string,
  query: string,
  options?: FindOptions,
): ReplaceRange[] {
  const needleRaw = query.trim();
  if (!needleRaw) return [];

  const locale = options?.locale || "tr";
  const caseSensitive = options?.caseSensitive === true;
  const wholeWord = options?.wholeWord === true;

  const source = caseSensitive ? text : text.toLocaleLowerCase(locale);
  const needle = caseSensitive ? needleRaw : needleRaw.toLocaleLowerCase(locale);
  if (!needle) return [];

  const ranges: ReplaceRange[] = [];
  let start = 0;
  while (start < source.length) {
    const index = source.indexOf(needle, start);
    if (index === -1) break;
    const to = index + needle.length;
    if (wholeWord) {
      const before = index > 0 ? text[index - 1] || "" : "";
      const after = to < text.length ? text[to] || "" : "";
      if (isWordChar(before) || isWordChar(after)) {
        start = to;
        continue;
      }
    }
    ranges.push({ from: index, to });
    start = to;
  }

  return ranges;
}

export function isRangeInsideWindow(range: ReplaceRange, window: MatchWindow): boolean {
  if (!isFiniteInteger(range.from) || !isFiniteInteger(range.to)) return false;
  if (!isFiniteInteger(window.from) || !isFiniteInteger(window.to)) return false;
  if (window.to <= window.from) return false;
  return range.from >= window.from && range.to <= window.to;
}
