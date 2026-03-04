import { createCorrelationId, errorJson, getClientIdentifier, successJson } from '@/lib/source-search/http';
import { checkSimpleRateLimit } from '@/lib/source-search/simple-rate-limit';
import { suggestQueries } from '@/lib/source-search/search-service';
import { isSearchTab } from '@/lib/source-search/types';

export const dynamic = 'force-dynamic';

const SUGGEST_RATE_LIMIT_PER_MINUTE = Number(process.env.SUGGEST_RATE_LIMIT_PER_MINUTE ?? 120);

export async function GET(request: Request) {
  const correlationId = createCorrelationId();
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
    },
    200,
    correlationId,
    rateLimit,
  );
}

