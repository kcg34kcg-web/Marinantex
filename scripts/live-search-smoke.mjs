/* eslint-disable no-console */

import process from 'node:process';

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const QUERY = process.env.SEARCH_SMOKE_QUERY ?? 'kidem tazminati';
const TAB = process.env.SEARCH_SMOKE_TAB ?? 'ictihat';
const TIMEOUT_MS = Number(process.env.SEARCH_SMOKE_TIMEOUT_MS ?? 12000);
const STRICT_RESULTS = String(process.env.SEARCH_SMOKE_STRICT_RESULTS ?? 'false').toLowerCase() === 'true';
const EXPECT_LIVE_MODE = String(process.env.SEARCH_SMOKE_EXPECT_LIVE_MODE ?? 'true').toLowerCase() === 'true';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pickErrorMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'unknown error payload';
  }
  if (payload.error && typeof payload.error === 'object') {
    if (typeof payload.error.message === 'string') {
      return payload.error.message;
    }
    if (typeof payload.error.code === 'string') {
      return payload.error.code;
    }
  }
  if (typeof payload.message === 'string') {
    return payload.message;
  }
  return 'unknown error payload';
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, TIMEOUT_MS));
  try {
    const response = await fetch(url, { signal: controller.signal });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const query = new URLSearchParams({
    q: QUERY,
    tab: TAB,
    sort: 'relevance',
    page: '1',
  });
  const url = `${WEB_BASE_URL}/api/search?${query.toString()}`;

  console.log(`[live-search-smoke] Requesting: ${url}`);
  const { response, body } = await fetchJson(url);
  if (!response.ok) {
    throw new Error(
      `[live-search-smoke] /api/search failed: status=${response.status} message=${pickErrorMessage(body)}`,
    );
  }

  assert(body && typeof body === 'object', '[live-search-smoke] response is not a JSON object.');
  assert(typeof body.correlation_id === 'string' && body.correlation_id.length > 0, '[live-search-smoke] missing correlation_id.');
  assert(Array.isArray(body.items), '[live-search-smoke] items is not an array.');
  assert(typeof body.total === 'number', '[live-search-smoke] total is not numeric.');
  assert(typeof body.page === 'number', '[live-search-smoke] page is not numeric.');
  assert(typeof body.page_size === 'number', '[live-search-smoke] page_size is not numeric.');
  assert(Array.isArray(body.adapters), '[live-search-smoke] adapters is not an array.');

  if (EXPECT_LIVE_MODE) {
    assert(body.search_mode === 'live', `[live-search-smoke] expected search_mode=live, got ${String(body.search_mode)}.`);
    assert(body.is_mock === false, '[live-search-smoke] expected is_mock=false in live mode.');
    assert(
      body.adapters.some((adapter) => adapter && adapter.mode === 'ACTIVE'),
      '[live-search-smoke] expected at least one ACTIVE adapter.',
    );
  }

  if (STRICT_RESULTS) {
    assert(body.total > 0, '[live-search-smoke] strict mode: expected total > 0.');
    assert(body.items.length > 0, '[live-search-smoke] strict mode: expected at least one item.');
  }

  const warnings = Array.isArray(body.warnings) ? body.warnings : [];
  console.log(
    JSON.stringify(
      {
        event: 'live_search_smoke_passed',
        web_base_url: WEB_BASE_URL,
        query: QUERY,
        tab: TAB,
        total: body.total,
        item_count: body.items.length,
        search_mode: body.search_mode,
        is_mock: body.is_mock,
        warnings,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
