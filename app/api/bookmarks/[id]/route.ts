import { deleteBookmark } from '@/lib/source-search/bookmark-store';
import { createCorrelationId, errorJson, successJson } from '@/lib/source-search/http';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function DELETE(_: Request, context: RouteContext) {
  const correlationId = createCorrelationId();
  const { id } = await context.params;

  if (!id || id.length > 120) {
    return errorJson(
      400,
      'id parametresi gecersiz.',
      correlationId,
      { code: 'INVALID_BOOKMARK_ID' },
    );
  }

  const deleted = deleteBookmark(id);
  if (!deleted) {
    return errorJson(
      404,
      'Bookmark bulunamadi.',
      correlationId,
      { code: 'BOOKMARK_NOT_FOUND' },
    );
  }

  return successJson({ deleted: true, id }, 200, correlationId);
}
