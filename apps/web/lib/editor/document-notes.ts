export type DocumentNoteScope = "PRIVATE" | "TEAM";

export interface DocumentNote {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  tags: string[];
  scope: DocumentNoteScope;
  selectedText?: string;
  from?: number;
  to?: number;
}

export interface DocumentNoteFilterOptions {
  query?: string;
  scope?: "ALL" | DocumentNoteScope;
  pinnedOnly?: boolean;
}

function toFinitePosition(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.floor(value);
  if (rounded <= 0) return undefined;
  return rounded;
}

function normalizeScope(value: unknown): DocumentNoteScope {
  return value === "TEAM" ? "TEAM" : "PRIVATE";
}

function normalizeTags(value: unknown): string[] {
  const rawList = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of rawList) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().toLocaleLowerCase("tr");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(normalized);
    if (tags.length >= 8) break;
  }
  return tags;
}

function normalizeNoteRecord(value: unknown): DocumentNote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;

  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return null;

  const createdAtRaw = typeof input.createdAt === "string" ? input.createdAt : "";
  const createdAt =
    createdAtRaw && Number.isFinite(Date.parse(createdAtRaw))
      ? createdAtRaw
      : new Date(0).toISOString();

  const updatedAtRaw = typeof input.updatedAt === "string" ? input.updatedAt : "";
  const updatedAt =
    updatedAtRaw && Number.isFinite(Date.parse(updatedAtRaw))
      ? updatedAtRaw
      : createdAt;

  const idRaw = typeof input.id === "string" ? input.id.trim() : "";
  const id =
    idRaw ||
    `note-${createdAt}-${body
      .toLocaleLowerCase("tr")
      .replace(/\s+/g, "-")
      .slice(0, 24)}`;

  const selectedText =
    typeof input.selectedText === "string" && input.selectedText.trim().length > 0
      ? input.selectedText.trim()
      : undefined;

  const from = toFinitePosition(input.from);
  const to = toFinitePosition(input.to);

  return {
    id,
    body,
    createdAt,
    updatedAt,
    pinned: input.pinned === true,
    tags: normalizeTags(input.tags),
    scope: normalizeScope(input.scope),
    selectedText,
    from,
    to,
  };
}

export function normalizeDocumentNotes(input: unknown): DocumentNote[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const normalized: DocumentNote[] = [];

  for (const item of input) {
    const note = normalizeNoteRecord(item);
    if (!note) continue;
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    normalized.push(note);
  }

  normalized.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
  return normalized;
}

export function filterDocumentNotes(
  notes: DocumentNote[],
  options?: DocumentNoteFilterOptions,
): DocumentNote[] {
  const scope = options?.scope || "ALL";
  const pinnedOnly = options?.pinnedOnly === true;
  const query = (options?.query || "").trim().toLocaleLowerCase("tr");

  return notes.filter((note) => {
    if (scope !== "ALL" && note.scope !== scope) return false;
    if (pinnedOnly && !note.pinned) return false;
    if (!query) return true;
    const haystack = [
      note.body,
      note.selectedText || "",
      note.tags.join(" "),
      note.scope,
    ]
      .join(" ")
      .toLocaleLowerCase("tr");
    return haystack.includes(query);
  });
}

export function collectTopNoteTags(notes: DocumentNote[], limit = 6): string[] {
  const counter = new Map<string, number>();
  notes.forEach((note) => {
    note.tags.forEach((tag) => {
      const normalized = tag.trim().toLocaleLowerCase("tr");
      if (!normalized) return;
      counter.set(normalized, (counter.get(normalized) || 0) + 1);
    });
  });

  return [...counter.entries()]
    .sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0], "tr");
    })
    .slice(0, Math.max(1, limit))
    .map(([tag]) => tag);
}
