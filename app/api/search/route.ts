import { errorJson, getClientIdentifier, successJson, createCorrelationId } from '@/lib/source-search/http';
import { checkSimpleRateLimit } from '@/lib/source-search/simple-rate-limit';
import { ensureLiveSearchAdapterRegistered } from '@/lib/source-search/live-rag-adapter';
import {
  hasLiveSearchAdapter,
  parseFiltersParam,
  parseSearchPage,
  searchDocumentsByBackend,
  SearchBackendContractError,
  type SearchBackendMode,
} from '@/lib/source-search/search-service';
import { isSearchSort, isSearchTab, type SearchResultPayload } from '@/lib/source-search/types';

export const dynamic = 'force-dynamic';

const SEARCH_RATE_LIMIT_PER_MINUTE = Number(process.env.SEARCH_RATE_LIMIT_PER_MINUTE ?? 60);
const SEARCH_TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS ?? 3_500);

function isTrueFlag(value: string | undefined, fallback = false): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function isProductionSearchRuntime(): boolean {
  return (
    (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production' ||
    (process.env.VERCEL_ENV ?? '').trim().toLowerCase() === 'production' ||
    (process.env.APP_ENV ?? '').trim().toLowerCase() === 'production'
  );
}

function resolveSearchBackendMode(): SearchBackendMode | null {
  const mode = (process.env.SEARCH_BACKEND_MODE ?? 'live').trim().toLowerCase();
  if (mode === 'mock' || mode === 'live') {
    return mode;
  }
  return null;
}

export async function GET(request: Request) {
  const correlationId = createCorrelationId();
  ensureLiveSearchAdapterRegistered();
  const backendMode = resolveSearchBackendMode();
  const requireLive = isTrueFlag(process.env.SEARCH_REQUIRE_LIVE, false);
  const allowMock = isTrueFlag(process.env.SEARCH_ALLOW_MOCK, false);
  const isProduction = isProductionSearchRuntime();
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
    if (!backendMode) {
      return errorJson(
        500,
        'SEARCH_BACKEND_MODE yalnizca mock veya live olabilir.',
        correlationId,
        { code: 'SEARCH_MODE_MISCONFIGURED' },
        rateLimit,
      );
    }

    if (isProduction && backendMode !== 'live') {
      return errorJson(
        503,
        'Uretim ortaminda mock arama devre disi; yalnizca canli arama kullanilabilir.',
        correlationId,
        { code: 'PRODUCTION_REQUIRES_LIVE_SEARCH' },
        rateLimit,
      );
    }

    if (requireLive && backendMode !== 'live') {
      return errorJson(
        503,
        'Bu ortamda canli arama zorunlu; mock arama kapali.',
        correlationId,
        { code: 'LIVE_SEARCH_REQUIRED' },
        rateLimit,
      );
    }

    if (backendMode === 'mock' && !allowMock) {
      return errorJson(
        503,
        'Mock arama bu ortamda kapali. Acmak icin SEARCH_ALLOW_MOCK=true ayarlayin.',
        correlationId,
        { code: 'MOCK_SEARCH_DISABLED' },
        rateLimit,
      );
    }

    if (backendMode === 'live' && !hasLiveSearchAdapter()) {
      return errorJson(
        503,
        'Canli arama adaptoru kayitli degil.',
        correlationId,
        { code: 'LIVE_SEARCH_ADAPTER_UNAVAILABLE' },
        rateLimit,
      );
    }

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
    let result: SearchResultPayload;
    try {
      result = await searchDocumentsByBackend(
        {
          q,
          tab,
          filters,
          page,
          sort,
        },
        backendMode,
      );
    } catch (error) {
      if (error instanceof SearchBackendContractError) {
        return errorJson(
          error.status,
          error.message,
          correlationId,
          { code: error.code },
          rateLimit,
        );
      }
      throw error;
    }

    const warnings =
      backendMode === 'mock'
        ? Array.from(
            new Set([
              'Mock veri ile arama yapiliyor; sonuclar canli resmi kaynak dogrulamasi icermez.',
              ...(result.warnings ?? []),
            ]),
          )
        : Array.from(new Set(result.warnings ?? []));
    const latency = Date.now() - startedAt;

    console.info(
      JSON.stringify({
        event: 'source_search',
        correlation_id: correlationId,
        search_mode: backendMode,
        is_mock: backendMode === 'mock',
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
        search_mode: backendMode,
        is_mock: backendMode === 'mock',
        capability: {
          live_adapter_registered: hasLiveSearchAdapter(),
          backend_mode: backendMode,
          production_runtime: isProduction,
          verified: backendMode === 'live' && hasLiveSearchAdapter(),
        },
        warnings,
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
