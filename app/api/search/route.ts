import { errorJson, getClientIdentifier, successJson, createCorrelationId } from '@/lib/source-search/http';
import { checkSimpleRateLimit } from '@/lib/source-search/simple-rate-limit';
import { parseFiltersParam, parseSearchPage, searchDocuments } from '@/lib/source-search/search-service';
import { isSearchSort, isSearchTab } from '@/lib/source-search/types';

export const dynamic = 'force-dynamic';

const SEARCH_RATE_LIMIT_PER_MINUTE = Number(process.env.SEARCH_RATE_LIMIT_PER_MINUTE ?? 60);
const SEARCH_TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS ?? 3_500);

export async function GET(request: Request) {
  const correlationId = createCorrelationId();
  const rateLimit = checkSimpleRateLimit(
    `${getClientIdentifier(request)}:search`,
    SEARCH_RATE_LIMIT_PER_MINUTE,
    60_000,
  );

  if (!rateLimit.allowed) {
    return errorJson(
      429,
      'Arama limiti asildi. Lutfen daha sonra tekrar deneyin.',
      correlationId,
      { code: 'RATE_LIMIT_EXCEEDED' },
      rateLimit,
    );
  }

  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').trim();
    const tab = url.searchParams.get('tab') ?? 'ictihat';
    const sort = url.searchParams.get('sort') ?? 'relevance';
    const page = parseSearchPage(url.searchParams.get('page'));

    if (q.length > 512) {
      return errorJson(
        422,
        'q parametresi 512 karakterden uzun olamaz.',
        correlationId,
        { code: 'QUERY_TOO_LONG' },
        rateLimit,
      );
    }

    if (!isSearchTab(tab)) {
      return errorJson(
        400,
        'tab parametresi gecersiz.',
        correlationId,
        { code: 'INVALID_TAB' },
        rateLimit,
      );
    }

    if (!isSearchSort(sort)) {
      return errorJson(
        400,
        'sort parametresi gecersiz.',
        correlationId,
        { code: 'INVALID_SORT' },
        rateLimit,
      );
    }

    if (!page) {
      return errorJson(
        400,
        'page parametresi pozitif tam sayi olmali.',
        correlationId,
        { code: 'INVALID_PAGE' },
        rateLimit,
      );
    }

    let filters;
    try {
      filters = parseFiltersParam(url.searchParams.get('filters'));
    } catch {
      return errorJson(
        400,
        'filters parametresi gecerli JSON olmali.',
        correlationId,
        { code: 'INVALID_FILTERS_JSON' },
        rateLimit,
      );
    }

    if (JSON.stringify(filters).length > 2000) {
      return errorJson(
        422,
        'filters parametresi cok buyuk.',
        correlationId,
        { code: 'FILTERS_TOO_LARGE' },
        rateLimit,
      );
    }

    const startedAt = Date.now();
    const result = searchDocuments({
      q,
      tab,
      filters,
      page,
      sort,
    });
    const latency = Date.now() - startedAt;

    console.info(
      JSON.stringify({
        event: 'source_search',
        correlation_id: correlationId,
        tab,
        page,
        sort,
        result_count: result.total,
        latency_ms: latency,
      }),
    );

    return successJson(
      {
        query: q,
        tab,
        sort,
        filters,
        timeout_ms: SEARCH_TIMEOUT_MS,
        latency_ms: latency,
        ...result,
      },
      200,
      correlationId,
      rateLimit,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'source_search_error',
        correlation_id: correlationId,
        message: error instanceof Error ? error.message : 'unknown error',
      }),
    );
    return errorJson(
      500,
      'Arama istegi islenemedi.',
      correlationId,
      { code: 'SEARCH_INTERNAL_ERROR' },
      rateLimit,
    );
  }
}

