import type { BookmarkRecord } from '@/lib/source-search/types';

const BOOKMARKS = new Map<string, BookmarkRecord>();

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createBookmark(input: {
  userId?: string;
  documentId: string;
  notes?: string | null;
}): BookmarkRecord {
  const now = new Date().toISOString();
  const bookmark: BookmarkRecord = {
    id: createId('bookmark'),
    user_id: input.userId ?? 'anonymous',
    document_id: input.documentId,
    notes: input.notes ?? null,
    created_at: now,
  };

  BOOKMARKS.set(bookmark.id, bookmark);
  return bookmark;
}

export function listBookmarks(userId = 'anonymous'): BookmarkRecord[] {
  return Array.from(BOOKMARKS.values())
    .filter((bookmark) => bookmark.user_id === userId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export function deleteBookmark(id: string): boolean {
  return BOOKMARKS.delete(id);
}

