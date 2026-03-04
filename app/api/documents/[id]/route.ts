import { createCorrelationId, errorJson, successJson } from '@/lib/source-search/http';
import { getDocumentById } from '@/lib/source-search/search-service';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(_: Request, context: RouteContext) {
  const correlationId = createCorrelationId();
  const { id } = await context.params;

  if (!id || id.length > 120) {
    return errorJson(
      400,
      'id parametresi gecersiz.',
      correlationId,
      { code: 'INVALID_DOCUMENT_ID' },
    );
  }

  const item = getDocumentById(id);
  if (!item) {
    return errorJson(
      404,
      'Dokuman bulunamadi.',
      correlationId,
      { code: 'DOCUMENT_NOT_FOUND' },
    );
  }

  return successJson({ item }, 200, correlationId);
}
