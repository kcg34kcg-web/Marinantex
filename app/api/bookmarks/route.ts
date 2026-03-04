import { createBookmark, listBookmarks } from '@/lib/source-search/bookmark-store';
import { createCorrelationId, errorJson, getClientIdentifier, successJson } from '@/lib/source-search/http';
import { checkSimpleRateLimit } from '@/lib/source-search/simple-rate-limit';
import { getDocumentById } from '@/lib/source-search/search-service';

export const dynamic = 'force-dynamic';

const BOOKMARK_RATE_LIMIT_PER_MINUTE = Number(process.env.BOOKMARK_RATE_LIMIT_PER_MINUTE ?? 90);

export async function GET(request: Request) {
  const correlationId = createCorrelationId();
  const userId = new URL(request.url).searchParams.get('user_id') ?? 'anonymous';

  return successJson(
    {
      items: listBookmarks(userId),
    },
    200,
    correlationId,
  );
}

export async function POST(request: Request) {
  const correlationId = createCorrelationId();
  const rateLimit = checkSimpleRateLimit(
    `${getClientIdentifier(request)}:bookmark:create`,
    BOOKMARK_RATE_LIMIT_PER_MINUTE,
    60_000,
  );

  if (!rateLimit.allowed) {
    return errorJson(
      429,
      'Kaydetme limiti asildi. Lutfen daha sonra tekrar deneyin.',
      correlationId,
      { code: 'RATE_LIMIT_EXCEEDED' },
      rateLimit,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson(
      400,
      'JSON body gerekli.',
      correlationId,
      { code: 'INVALID_JSON_BODY' },
      rateLimit,
    );
  }

  const payload = body as {
    document_id?: unknown;
    user_id?: unknown;
    notes?: unknown;
  };

  if (typeof payload.document_id !== 'string' || !payload.document_id.trim()) {
    return errorJson(
      400,
      'document_id zorunlu.',
      correlationId,
      { code: 'MISSING_DOCUMENT_ID' },
      rateLimit,
    );
  }

  if (payload.notes && typeof payload.notes !== 'string') {
    return errorJson(
      400,
      'notes parametresi metin olmali.',
      correlationId,
      { code: 'INVALID_NOTES' },
      rateLimit,
    );
  }

  if (typeof payload.notes === 'string' && payload.notes.length > 1000) {
    return errorJson(
      422,
      'notes en fazla 1000 karakter olabilir.',
      correlationId,
      { code: 'NOTES_TOO_LONG' },
      rateLimit,
    );
  }

  const existingDocument = getDocumentById(payload.document_id.trim());
  if (!existingDocument) {
    return errorJson(
      422,
      'Belirtilen dokuman bulunamadi.',
      correlationId,
      { code: 'DOCUMENT_NOT_FOUND' },
      rateLimit,
    );
  }

  const bookmark = createBookmark({
    documentId: existingDocument.id,
    userId: typeof payload.user_id === 'string' && payload.user_id.trim() ? payload.user_id.trim() : 'anonymous',
    notes: typeof payload.notes === 'string' ? payload.notes : null,
  });

  console.info(
    JSON.stringify({
      event: 'bookmark_created',
      correlation_id: correlationId,
      bookmark_id: bookmark.id,
      document_id: bookmark.document_id,
      user_id: bookmark.user_id,
    }),
  );

  return successJson({ bookmark }, 201, correlationId, rateLimit);
}

