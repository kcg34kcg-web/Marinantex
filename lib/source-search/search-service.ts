import { MOCK_DOCUMENTS, SOURCE_ADAPTER_STATUSES } from '@/lib/source-search/mock-data';
import type {
  DocumentRecord,
  SearchFilters,
  SearchRequestInput,
  SearchResultPayload,
  SearchTab,
} from '@/lib/source-search/types';
import { sanitizeFilters } from '@/lib/source-search/types';

export const SEARCH_PAGE_SIZE = 10;
export type SearchBackendMode = 'mock' | 'live';
const DOCUMENT_CACHE_MAX_ITEMS = 1000;

export interface LiveSearchAdapter {
  search(input: SearchRequestInput): Promise<SearchResultPayload>;
}

export class SearchBackendContractError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 503) {
    super(message);
    this.name = 'SearchBackendContractError';
    this.code = code;
    this.status = status;
  }
}

let liveSearchAdapter: LiveSearchAdapter | null = null;
const documentCache = new Map<string, DocumentRecord>();

function rememberDocuments(items: DocumentRecord[]): void {
  for (const item of items) {
    if (!item?.id) {
      continue;
    }
    documentCache.set(item.id, item);
  }
  while (documentCache.size > DOCUMENT_CACHE_MAX_ITEMS) {
    const oldest = documentCache.keys().next().value;
    if (!oldest) {
      break;
    }
    documentCache.delete(oldest);
  }
}

interface ScoredDocument {
  document: DocumentRecord;
  score: number;
  timestamp: number;
}

function parseDateValue(value?: string | null): number {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function toLower(value?: string | null): string {
  return (value ?? '').toLowerCase();
}

function contains(haystack: string, needle: string): boolean {
  if (!needle) {
    return true;
  }
  return haystack.includes(needle.toLowerCase());
}

function matchesDateRange(value: string | null | undefined, from?: string, to?: string): boolean {
  const timestamp = parseDateValue(value);
  if (!timestamp) {
    return !from && !to;
  }

  if (from && timestamp < parseDateValue(from)) {
    return false;
  }
  if (to) {
    const endOfDay = parseDateValue(to) + 86_399_000;
    if (timestamp > endOfDay) {
      return false;
    }
  }
  return true;
}

function parseCaseNumbersFromQuery(query: string): { esasNo?: string; kararNo?: string } {
  const normalized = query.replace(/\s+/g, ' ').trim();
  const esasMatch = normalized.match(/(\d{4}\/\d+)\s*e\.?/i);
  const kararMatch = normalized.match(/(\d{4}\/\d+)\s*k\.?/i);

  return {
    esasNo: esasMatch?.[1],
    kararNo: kararMatch?.[1],
  };
}

function matchesFilters(document: DocumentRecord, tab: SearchTab, filters: SearchFilters): boolean {
  if (filters.source_type && !contains(toLower(document.source_type), filters.source_type)) {
    return false;
  }

  if (tab === 'ictihat') {
    if (!contains(toLower(document.source_name), filters.source_name ?? '')) {
      return false;
    }
    if (!contains(toLower(document.court), filters.court ?? '')) {
      return false;
    }
    if (!contains(toLower(document.chamber), filters.chamber ?? '')) {
      return false;
    }
    if (!contains(toLower(document.esas_no), filters.esas_no ?? filters.docket_no ?? '')) {
      return false;
    }
    if (!contains(toLower(document.karar_no), filters.karar_no ?? filters.decision_no ?? '')) {
      return false;
    }
    if (!matchesDateRange(
      document.decision_date,
      filters.decision_date_from ?? filters.date_from,
      filters.decision_date_to ?? filters.date_to,
    )) {
      return false;
    }
    return true;
  }

  if (tab === 'mevzuat') {
    if (!contains(toLower(document.title), filters.law_name ?? '') && !contains(toLower(document.snippet), filters.law_name ?? '')) {
      return false;
    }
    if (!contains(toLower(document.title), filters.law_no ?? '')) {
      return false;
    }
    if (
      !contains(toLower(document.title), filters.article ?? filters.article_no ?? '')
      && !contains(toLower(document.snippet), filters.article ?? filters.article_no ?? '')
    ) {
      return false;
    }
    if (!contains(toLower(document.source_name), filters.official_gazette ?? '')) {
      return false;
    }
    if (!matchesDateRange(document.publish_date, filters.publish_date_from, filters.publish_date_to)) {
      return false;
    }
    return true;
  }

  if (tab === 'akademik') {
    if (!contains(toLower(document.source_name), filters.journal ?? '')) {
      return false;
    }
    if (!contains(toLower(document.publish_date), filters.year ?? '')) {
      return false;
    }
    if (!contains(toLower(document.title), filters.keyword ?? '') && !contains(toLower(document.snippet), filters.keyword ?? '')) {
      return false;
    }
    if (!contains(toLower(document.authors?.join(' ')), filters.author ?? '')) {
      return false;
    }
    if (!contains(toLower(document.doi), filters.doi ?? '')) {
      return false;
    }
    return true;
  }

  if (!contains(toLower(document.url_original), filters.domain ?? '')) {
    return false;
  }
  if (!matchesDateRange(document.publish_date, filters.publish_date_from, filters.publish_date_to)) {
    return false;
  }
  return true;
}

function scoreDocument(document: DocumentRecord, query: string): number {
  if (!query.trim()) {
    return 1;
  }

  const normalizedQuery = query.toLowerCase().trim();
  const queryTerms = normalizedQuery.split(/\s+/).filter((term) => term.length > 1);
  const parsedCaseNumbers = parseCaseNumbersFromQuery(query);

  let score = 0;
  for (const term of queryTerms) {
    if (toLower(document.title).includes(term)) {
      score += 6;
    }
    if (toLower(document.snippet).includes(term)) {
      score += 3;
    }
    if (document.tags.some((tag) => toLower(tag).includes(term))) {
      score += 2;
    }
    if (toLower(document.source_name).includes(term)) {
      score += 1;
    }
  }

  if (parsedCaseNumbers.esasNo && document.esas_no === parsedCaseNumbers.esasNo) {
    score += 8;
  }
  if (parsedCaseNumbers.kararNo && document.karar_no === parsedCaseNumbers.kararNo) {
    score += 8;
  }

  return score;
}

function dateForSort(document: DocumentRecord): number {
  return parseDateValue(document.decision_date) || parseDateValue(document.publish_date);
}

export function parseSearchPage(rawPage: string | null): number | null {
  if (!rawPage) {
    return 1;
  }
  const parsed = Number(rawPage);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
    return null;
  }
  return parsed;
}

export function parseFiltersParam(rawFilters: string | null): SearchFilters {
  if (!rawFilters) {
    return {};
  }

  const parsed = JSON.parse(rawFilters) as unknown;
  return sanitizeFilters(parsed);
}

export function getDocumentById(id: string): DocumentRecord | null {
  const cached = documentCache.get(id);
  if (cached) {
    return cached;
  }
  const fallback = MOCK_DOCUMENTS.find((document) => document.id === id) ?? null;
  if (fallback) {
    rememberDocuments([fallback]);
  }
  return fallback;
}

export function searchDocuments(input: SearchRequestInput): SearchResultPayload {
  const candidates: ScoredDocument[] = MOCK_DOCUMENTS
    .filter((document) => document.source_type === input.tab)
    .filter((document) => matchesFilters(document, input.tab, input.filters))
    .map((document) => ({
      document,
      score: scoreDocument(document, input.q),
      timestamp: dateForSort(document),
    }))
    .filter((entry) => entry.score > 0);

  candidates.sort((left, right) => {
    if (input.sort === 'date_desc') {
      return right.timestamp - left.timestamp || right.score - left.score;
    }
    if (input.sort === 'date_asc') {
      return left.timestamp - right.timestamp || right.score - left.score;
    }
    return right.score - left.score || right.timestamp - left.timestamp;
  });

  const total = candidates.length;
  const startIndex = (input.page - 1) * SEARCH_PAGE_SIZE;
  const pagedItems = candidates.slice(startIndex, startIndex + SEARCH_PAGE_SIZE).map((entry) => entry.document);

  const adapters = SOURCE_ADAPTER_STATUSES.filter((adapter) => adapter.tab === input.tab);
  const partialSources = adapters.filter((adapter) => adapter.mode !== 'ACTIVE').map((adapter) => adapter.source_name);
  const warnings =
    partialSources.length > 0
      ? ['Bazi kaynaklar canli sorguda kullanima acik degil; redirect veya metadata fallback devrede.']
      : [];

  const payload = {
    items: pagedItems,
    total,
    page: input.page,
    page_size: SEARCH_PAGE_SIZE,
    warnings,
    partial_sources: partialSources,
    adapters,
  };
  rememberDocuments(payload.items);
  return payload;
}

export function registerLiveSearchAdapter(adapter: LiveSearchAdapter): void {
  liveSearchAdapter = adapter;
}

export function clearLiveSearchAdapter(): void {
  liveSearchAdapter = null;
}

export function hasLiveSearchAdapter(): boolean {
  return liveSearchAdapter !== null;
}

export async function searchDocumentsByBackend(
  input: SearchRequestInput,
  mode: SearchBackendMode,
): Promise<SearchResultPayload> {
  if (mode === 'live') {
    if (!liveSearchAdapter) {
      throw new SearchBackendContractError(
        'LIVE_SEARCH_ADAPTER_NOT_REGISTERED',
        'Canli arama adaptoru kayitli degil.',
        503,
      );
    }
    const payload = await liveSearchAdapter.search(input);
    rememberDocuments(payload.items);
    return payload;
  }
  return searchDocuments(input);
}

export function suggestQueries(query: string, tab?: SearchTab): string[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) {
    return [];
  }

  const cachedDocuments = Array.from(documentCache.values());
  const scope = tab
    ? cachedDocuments.filter((document) => document.source_type === tab)
    : cachedDocuments;
  if (scope.length === 0) {
    return [];
  }
  const candidates = new Set<string>();

  for (const document of scope) {
    if (toLower(document.title).includes(normalized)) {
      candidates.add(document.title);
    }
    for (const tag of document.tags) {
      if (toLower(tag).includes(normalized)) {
        candidates.add(tag);
      }
    }
  }

  return Array.from(candidates).slice(0, 8);
}
