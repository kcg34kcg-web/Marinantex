import { createCorrelationId, errorJson, getClientIdentifier, successJson } from '@/lib/source-search/http';
import { checkSimpleRateLimit } from '@/lib/source-search/simple-rate-limit';
import { suggestQueries } from '@/lib/source-search/search-service';
import { ensureLiveSearchAdapterRegistered } from '@/lib/source-search/live-rag-adapter';
import { isSearchTab } from '@/lib/source-search/types';

export const dynamic = 'force-dynamic';

const SUGGEST_RATE_LIMIT_PER_MINUTE = Number(process.env.SUGGEST_RATE_LIMIT_PER_MINUTE ?? 120);

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

function resolveSearchBackendMode(): 'mock' | 'live' | null {
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
    `${getClientIdentifier(request)}:suggest`,
    SUGGEST_RATE_LIMIT_PER_MINUTE,
    60_000,
  );

  if (!rateLimit.allowed) {
    return errorJson(
      429,
      'Oneri limiti asildi. Lutfen daha sonra tekrar deneyin.',
      correlationId,
      { code: 'RATE_LIMIT_EXCEEDED' },
      rateLimit,
    );
  }

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
      'Uretim ortaminda mock suggest devre disi; yalnizca canli arama kullanilabilir.',
      correlationId,
      { code: 'PRODUCTION_REQUIRES_LIVE_SEARCH' },
      rateLimit,
    );
  }

  if (requireLive && backendMode !== 'live') {
    return errorJson(
      503,
      'Bu ortamda canli arama zorunlu; mock suggest kapali.',
      correlationId,
      { code: 'LIVE_SEARCH_REQUIRED' },
      rateLimit,
    );
  }

  if (backendMode === 'mock' && !allowMock) {
    return errorJson(
      503,
      'Mock suggest bu ortamda kapali. Acmak icin SEARCH_ALLOW_MOCK=true ayarlayin.',
      correlationId,
      { code: 'MOCK_SEARCH_DISABLED' },
      rateLimit,
    );
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const tab = url.searchParams.get('tab');

  if (q.length < 2) {
    return errorJson(
      422,
      'q parametresi en az 2 karakter olmali.',
      correlationId,
      { code: 'QUERY_TOO_SHORT' },
      rateLimit,
    );
  }

  if (tab && !isSearchTab(tab)) {
    return errorJson(
      400,
      'tab parametresi gecersiz.',
      correlationId,
      { code: 'INVALID_TAB' },
      rateLimit,
    );
  }

  const items = suggestQueries(q, tab && isSearchTab(tab) ? tab : undefined);
  return successJson(
    {
      q,
      tab: tab ?? null,
      items,
      search_mode: backendMode,
      is_mock: backendMode === 'mock',
    },
    200,
    correlationId,
    rateLimit,
  );
}

