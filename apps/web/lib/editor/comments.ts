export interface DocumentComment {
  id: string;
  body: string;
  selectedText: string;
  createdAt: string;
  resolved: boolean;
  from?: number;
  to?: number;
}

function toFinitePosition(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.floor(value);
  if (rounded <= 0) return undefined;
  return rounded;
}

function normalizeCommentRecord(value: unknown): DocumentComment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;

  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return null;

  const selectedText =
    typeof input.selectedText === "string" && input.selectedText.trim().length > 0
      ? input.selectedText.trim()
      : "(secim kaydi yok)";

  const createdAtRaw = typeof input.createdAt === "string" ? input.createdAt : "";
  const createdAt =
    createdAtRaw && Number.isFinite(Date.parse(createdAtRaw))
      ? createdAtRaw
      : new Date(0).toISOString();
  const idRaw = typeof input.id === "string" ? input.id.trim() : "";
  const id =
    idRaw ||
    `comment-${createdAt}-${body
      .toLocaleLowerCase("tr")
      .replace(/\s+/g, "-")
      .slice(0, 24)}`;

  const from = toFinitePosition(input.from);
  const to = toFinitePosition(input.to);

  return {
    id,
    body,
    selectedText,
    createdAt,
    resolved: input.resolved === true,
    from,
    to,
  };
}

export function normalizeDocumentComments(input: unknown): DocumentComment[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const normalized: DocumentComment[] = [];

  for (const item of input) {
    const comment = normalizeCommentRecord(item);
    if (!comment) continue;
    if (seen.has(comment.id)) continue;
    seen.add(comment.id);
    normalized.push(comment);
  }

  normalized.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return normalized;
}
