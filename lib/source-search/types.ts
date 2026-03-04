export const SEARCH_TABS = ['ictihat', 'mevzuat', 'akademik', 'web'] as const;
export type SearchTab = (typeof SEARCH_TABS)[number];

export const SEARCH_SORTS = ['relevance', 'date_desc', 'date_asc'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export type SourceType = SearchTab;

export type SearchFilterKey =
  | 'source_name'
  | 'court'
  | 'chamber'
  | 'decision_date_from'
  | 'decision_date_to'
  | 'esas_no'
  | 'karar_no'
  | 'law_name'
  | 'law_no'
  | 'article'
  | 'publish_date_from'
  | 'publish_date_to'
  | 'official_gazette'
  | 'journal'
  | 'year'
  | 'keyword'
  | 'author'
  | 'doi'
  | 'domain';

export type SearchFilters = Partial<Record<SearchFilterKey, string>>;

export interface DocumentRecord {
  id: string;
  source_type: SourceType;
  source_name: string;
  court?: string | null;
  chamber?: string | null;
  decision_date?: string | null;
  publish_date?: string | null;
  esas_no?: string | null;
  karar_no?: string | null;
  title: string;
  snippet: string;
  full_text?: string | null;
  authors?: string[] | null;
  doi?: string | null;
  tags: string[];
  url_original: string;
  created_at: string;
  updated_at: string;
}

export type AdapterMode = 'ACTIVE' | 'NOT_IMPLEMENTED_YET' | 'REDIRECT_ONLY_MVP';

export interface SourceAdapterStatus {
  adapter_id: string;
  tab: SearchTab;
  source_name: string;
  mode: AdapterMode;
  verification_required: boolean;
  assumption: string;
  validation_step: string;
  fallback_action: string;
  fallback_url?: string;
}

export interface SearchRequestInput {
  q: string;
  tab: SearchTab;
  filters: SearchFilters;
  page: number;
  sort: SearchSort;
}

export interface SearchResultPayload {
  items: DocumentRecord[];
  total: number;
  page: number;
  page_size: number;
  warnings: string[];
  partial_sources: string[];
  adapters: SourceAdapterStatus[];
}

export interface BookmarkRecord {
  id: string;
  user_id: string;
  document_id: string;
  notes?: string | null;
  created_at: string;
}

const FILTER_KEYS: SearchFilterKey[] = [
  'source_name',
  'court',
  'chamber',
  'decision_date_from',
  'decision_date_to',
  'esas_no',
  'karar_no',
  'law_name',
  'law_no',
  'article',
  'publish_date_from',
  'publish_date_to',
  'official_gazette',
  'journal',
  'year',
  'keyword',
  'author',
  'doi',
  'domain',
];

export function isSearchTab(value: string | null | undefined): value is SearchTab {
  if (!value) {
    return false;
  }
  return SEARCH_TABS.includes(value as SearchTab);
}

export function isSearchSort(value: string | null | undefined): value is SearchSort {
  if (!value) {
    return false;
  }
  return SEARCH_SORTS.includes(value as SearchSort);
}

export function sanitizeFilters(filters: unknown): SearchFilters {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    return {};
  }

  const rawFilters = filters as Record<string, unknown>;
  const cleaned: SearchFilters = {};

  for (const key of FILTER_KEYS) {
    const value = rawFilters[key];
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed) {
      cleaned[key] = trimmed;
    }
  }

  return cleaned;
}

