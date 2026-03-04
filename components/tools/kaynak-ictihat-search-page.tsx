'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { AlertTriangle, ExternalLink, Loader2, Search, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type {
  DocumentRecord,
  SearchFilters,
  SearchSort,
  SearchTab,
  SourceAdapterStatus,
} from '@/lib/source-search/types';
import { isSearchSort, isSearchTab, sanitizeFilters } from '@/lib/source-search/types';

interface SearchUIState {
  q: string;
  tab: SearchTab;
  filters: SearchFilters;
  page: number;
  sort: SearchSort;
}

interface SearchApiResponse {
  items: DocumentRecord[];
  total: number;
  page: number;
  page_size: number;
  warnings: string[];
  adapters: SourceAdapterStatus[];
  latency_ms: number;
}

interface ErrorApiResponse {
  error?: {
    message?: string;
  };
}

type BookmarkState = 'idle' | 'saving' | 'saved' | 'error';

interface FilterFieldConfig {
  key: keyof SearchFilters;
  label: string;
  placeholder: string;
  type?: 'text' | 'date';
}

const TAB_ORDER: SearchTab[] = ['ictihat', 'mevzuat', 'akademik', 'web'];

const TAB_LABELS: Record<SearchTab, string> = {
  ictihat: 'Ictihat',
  mevzuat: 'Mevzuat',
  akademik: 'Akademik',
  web: 'Web',
};

const TAB_PLACEHOLDERS: Record<SearchTab, string> = {
  ictihat: 'Orn: Yargitay 3. HD 2021/3456 E. 2022/7890 K.',
  mevzuat: 'Orn: 6098 TBK madde 138',
  akademik: 'Orn: kira uyarlama dergipark',
  web: 'Orn: site:gov.tr uyap duyuru',
};

const FILTER_CONFIG: Record<SearchTab, FilterFieldConfig[]> = {
  ictihat: [
    { key: 'source_name', label: 'Mahkeme/Kaynak', placeholder: 'Orn: Yargitay' },
    { key: 'court', label: 'Mahkeme', placeholder: 'Orn: Danistay' },
    { key: 'chamber', label: 'Daire/Kurul', placeholder: 'Orn: 3. Hukuk Dairesi' },
    { key: 'decision_date_from', label: 'Karar Tarihi Baslangic', placeholder: 'YYYY-AA-GG', type: 'date' },
    { key: 'decision_date_to', label: 'Karar Tarihi Bitis', placeholder: 'YYYY-AA-GG', type: 'date' },
    { key: 'esas_no', label: 'Esas No', placeholder: 'Orn: 2021/3456' },
    { key: 'karar_no', label: 'Karar No', placeholder: 'Orn: 2022/7890' },
  ],
  mevzuat: [
    { key: 'law_name', label: 'Kanun Adi', placeholder: 'Orn: Turk Borclar Kanunu' },
    { key: 'law_no', label: 'Kanun No', placeholder: 'Orn: 6098' },
    { key: 'article', label: 'Madde', placeholder: 'Orn: 138' },
    { key: 'publish_date_from', label: 'Tarih Baslangic', placeholder: 'YYYY-AA-GG', type: 'date' },
    { key: 'publish_date_to', label: 'Tarih Bitis', placeholder: 'YYYY-AA-GG', type: 'date' },
    { key: 'official_gazette', label: 'Resmi Gazete', placeholder: 'Orn: 27836' },
  ],
  akademik: [
    { key: 'journal', label: 'Dergi', placeholder: 'Orn: DergiPark' },
    { key: 'year', label: 'Yil', placeholder: 'Orn: 2024' },
    { key: 'keyword', label: 'Anahtar Kelime', placeholder: 'Orn: uyarlama' },
    { key: 'author', label: 'Yazar', placeholder: 'Orn: Yilmaz' },
    { key: 'doi', label: 'DOI', placeholder: 'Orn: 10.xxxx/xxxx' },
  ],
  web: [
    { key: 'domain', label: 'Alan Adi Kisiti', placeholder: 'Orn: gov.tr' },
    { key: 'publish_date_from', label: 'Tarih Baslangic', placeholder: 'YYYY-AA-GG', type: 'date' },
    { key: 'publish_date_to', label: 'Tarih Bitis', placeholder: 'YYYY-AA-GG', type: 'date' },
  ],
};

function parseStateFromQueryString(queryString: string): SearchUIState {
  const params = new URLSearchParams(queryString);
  const tab = isSearchTab(params.get('tab')) ? (params.get('tab') as SearchTab) : 'ictihat';
  const sort = isSearchSort(params.get('sort')) ? (params.get('sort') as SearchSort) : 'relevance';
  const rawPage = Number(params.get('page') ?? '1');
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  let filters: SearchFilters = {};
  const rawFilters = params.get('filters');
  if (rawFilters) {
    try {
      filters = sanitizeFilters(JSON.parse(rawFilters) as unknown);
    } catch {
      filters = {};
    }
  }

  return {
    q: (params.get('q') ?? '').trim(),
    tab,
    filters,
    page,
    sort,
  };
}

function toQueryString(state: SearchUIState): string {
  const params = new URLSearchParams();
  if (state.q) {
    params.set('q', state.q);
  }
  params.set('tab', state.tab);
  if (state.page > 1) {
    params.set('page', String(state.page));
  }
  if (state.sort !== 'relevance') {
    params.set('sort', state.sort);
  }
  const filters = sanitizeFilters(state.filters);
  if (Object.keys(filters).length > 0) {
    params.set('filters', JSON.stringify(filters));
  }
  return params.toString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlighted(text: string, query: string): ReactNode {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 1)
    .slice(0, 4);
  if (!terms.length) {
    return text;
  }
  const pattern = new RegExp(`(${terms.map((term) => escapeRegExp(term)).join('|')})`, 'ig');
  return text.split(pattern).map((part, index) =>
    terms.includes(part.toLowerCase()) ? (
      <mark key={`${part}-${index}`} className="rounded bg-[color-mix(in_srgb,var(--accent),white_60%)] px-1">
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    ),
  );
}

function formatDate(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleDateString('tr-TR');
}

function sourceBadgeClass(type: SearchTab): string {
  if (type === 'ictihat') return 'border-emerald-200 bg-emerald-100 text-emerald-900';
  if (type === 'mevzuat') return 'border-blue-200 bg-blue-100 text-blue-900';
  if (type === 'akademik') return 'border-amber-200 bg-amber-100 text-amber-900';
  return 'border-slate-200 bg-slate-100 text-slate-900';
}

function AdapterBadge({ mode }: { mode: SourceAdapterStatus['mode'] }) {
  if (mode === 'ACTIVE') {
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-900">ACTIVE</span>;
  }
  if (mode === 'REDIRECT_ONLY_MVP') {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">REDIRECT_ONLY_MVP</span>;
  }
  return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-900">NOT_IMPLEMENTED_YET</span>;
}

export function KaynakIctihatSearchPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const parsedState = useMemo(() => parseStateFromQueryString(searchParamsKey), [searchParamsKey]);

  const [uiState, setUiState] = useState<SearchUIState>(parsedState);
  const [queryInput, setQueryInput] = useState(parsedState.q);
  const [result, setResult] = useState<SearchApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [detail, setDetail] = useState<DocumentRecord | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [bookmarkStates, setBookmarkStates] = useState<Record<string, BookmarkState>>({});

  useEffect(() => {
    setUiState(parsedState);
    setQueryInput(parsedState.q);
  }, [parsedState]);

  const applyState = useCallback(
    (nextState: SearchUIState) => {
      setUiState(nextState);
      const nextQuery = toQueryString(nextState);
      const nextUrl = (nextQuery ? `${pathname}?${nextQuery}` : pathname) as Route;
      router.replace(nextUrl, { scroll: false });
    },
    [pathname, router],
  );

  const filtersKey = useMemo(() => JSON.stringify(sanitizeFilters(uiState.filters)), [uiState.filters]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    fetch(`/api/search?${toQueryString(uiState)}`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        const payload = (await response.json()) as SearchApiResponse | ErrorApiResponse;
        if (!response.ok) {
          const message = 'error' in payload ? payload.error?.message : undefined;
          throw new Error(message ?? 'Arama basarisiz.');
        }
        setResult(payload as SearchApiResponse);
      })
      .catch((fetchError) => {
        if (controller.signal.aborted) return;
        setResult(null);
        setError(fetchError instanceof Error ? fetchError.message : 'Arama basarisiz.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [uiState.q, uiState.tab, uiState.page, uiState.sort, filtersKey, reloadToken]);

  const updateFilter = useCallback(
    (key: keyof SearchFilters, value: string) => {
      applyState({
        ...uiState,
        page: 1,
        filters: sanitizeFilters({
          ...uiState.filters,
          [key]: value,
        }),
      });
    },
    [applyState, uiState],
  );

  const onSearch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      applyState({
        ...uiState,
        q: queryInput.trim(),
        page: 1,
      });
    },
    [applyState, queryInput, uiState],
  );

  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
      const payload = (await response.json()) as { item?: DocumentRecord; error?: { message?: string } };
      if (!response.ok || !payload.item) {
        throw new Error(payload.error?.message ?? 'Detay alinamadi.');
      }
      setDetail(payload.item);
    } catch (requestError) {
      setDetail(null);
      setDetailError(requestError instanceof Error ? requestError.message : 'Detay alinamadi.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const saveBookmark = useCallback(async (documentId: string) => {
    setBookmarkStates((prev) => ({ ...prev, [documentId]: 'saving' }));
    try {
      const response = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ document_id: documentId }),
      });
      if (!response.ok) {
        throw new Error('Bookmark kaydi basarisiz.');
      }
      setBookmarkStates((prev) => ({ ...prev, [documentId]: 'saved' }));
    } catch {
      setBookmarkStates((prev) => ({ ...prev, [documentId]: 'error' }));
    }
  }, []);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.page_size)) : 1;

  return (
    <section className="space-y-5">
      <header className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-[var(--text)]">Kaynak / Ictihat Arama</h1>
            <p className="text-sm text-[var(--secondary)]">Ictihat, mevzuat, akademik ve web aramalarini tek ekranda yonetin.</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
            Bu bir hukuki danismanlik degildir.
          </div>
        </div>

        <form onSubmit={onSearch} className="flex flex-col gap-3 sm:flex-row">
          <label htmlFor="source-search-input" className="sr-only">
            Kaynak arama metni
          </label>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--secondary)]" />
            <Input
              id="source-search-input"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder={TAB_PLACEHOLDERS[uiState.tab]}
              className="pl-10"
              aria-label="Arama sorgusu"
            />
          </div>
          <Button type="submit">Ara</Button>
        </form>

        <div role="tablist" aria-label="Arama sekmeleri" className="flex flex-wrap gap-2">
          {TAB_ORDER.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={uiState.tab === tab}
              onClick={() =>
                applyState({
                  ...uiState,
                  tab,
                  page: 1,
                  sort: 'relevance',
                  filters: {},
                })
              }
              className={cn(
                'rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
                uiState.tab === tab
                  ? 'border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary),white_80%)] text-[var(--primary)]'
                  : 'border-[var(--border)] text-[var(--secondary)] hover:text-[var(--text)]',
              )}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_330px]">
        <aside className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--text)]">Filtreler</h2>

          {FILTER_CONFIG[uiState.tab].map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label htmlFor={`filter-${field.key}`} className="text-xs font-medium text-[var(--secondary)]">
                {field.label}
              </label>
              <Input
                id={`filter-${field.key}`}
                type={field.type ?? 'text'}
                value={uiState.filters[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={(event) => updateFilter(field.key, event.target.value)}
                aria-label={field.label}
              />
            </div>
          ))}

          <div className="space-y-1.5">
            <label htmlFor="sort-input" className="text-xs font-medium text-[var(--secondary)]">
              Siralama
            </label>
            <select
              id="sort-input"
              value={uiState.sort}
              onChange={(event) => {
                const sort = isSearchSort(event.target.value) ? event.target.value : 'relevance';
                applyState({
                  ...uiState,
                  page: 1,
                  sort,
                });
              }}
              className="flex min-h-[44px] w-full rounded-xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] px-3 py-2 text-sm text-[var(--main-text,var(--text))]"
            >
              <option value="relevance">Ilgi</option>
              <option value="date_desc">Tarih (Yeni -&gt; Eski)</option>
              <option value="date_asc">Tarih (Eski -&gt; Yeni)</option>
            </select>
          </div>
        </aside>

        <div className="space-y-3">
          {result?.warnings.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Bazi kaynaklar yanit vermedi
              </div>
              <p>{result.warnings[0]}</p>
            </div>
          ) : null}

          {result?.adapters?.length ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">Adapter Durumu</h2>
              <div className="space-y-2">
                {result.adapters.map((adapter) => (
                  <div key={adapter.adapter_id} className="flex items-center justify-between rounded-xl border border-[var(--border)] p-2 text-xs">
                    <span className="font-medium text-[var(--text)]">{adapter.source_name}</span>
                    <AdapterBadge mode={adapter.mode} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--text)]">Sonuclar</h2>
              <div className="text-xs text-[var(--secondary)]" aria-live="polite">
                {isLoading ? 'Yukleniyor...' : `${result?.total ?? 0} sonuc`}
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={`sk-${index}`} className="space-y-2 rounded-xl border border-[var(--border)] p-3">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                ))}
              </div>
            ) : null}

            {!isLoading && error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                <p className="font-medium">{error}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setReloadToken((old) => old + 1)}>
                  Tekrar dene
                </Button>
              </div>
            ) : null}

            {!isLoading && !error && !result?.items.length ? (
              <div className="rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface),var(--bg)_8%)] p-4 text-sm text-[var(--secondary)]">
                Sonuc bulunamadi.
              </div>
            ) : null}

            {!isLoading && !error && result?.items.length ? (
              <div className="space-y-3">
                {result.items.map((item) => {
                  const bookmarkState = bookmarkStates[item.id] ?? 'idle';
                  return (
                    <article key={item.id} className="rounded-xl border border-[var(--border)] p-4">
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <h3 className="text-base font-semibold text-[var(--text)]">{item.title}</h3>
                        <span className={cn('rounded-full border px-2 py-1 text-[10px] font-semibold', sourceBadgeClass(item.source_type))}>
                          {item.source_name}
                        </span>
                      </div>
                      <p className="mb-2 text-xs text-[var(--secondary)]">
                        Tarih: {formatDate(item.decision_date ?? item.publish_date)}
                        {item.esas_no ? ` | E: ${item.esas_no}` : ''}
                        {item.karar_no ? ` | K: ${item.karar_no}` : ''}
                      </p>
                      <p className="text-sm text-[var(--secondary)]">{renderHighlighted(item.snippet, uiState.q)}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => openDetail(item.id)}>
                          Detay
                        </Button>
                        <a
                          href={item.url_original}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)]"
                        >
                          Kaynaga git
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <Button
                          variant={bookmarkState === 'saved' ? 'accent' : 'ghost'}
                          size="sm"
                          onClick={() => saveBookmark(item.id)}
                          disabled={bookmarkState === 'saving'}
                        >
                          {bookmarkState === 'saving' ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Kaydediliyor
                            </>
                          ) : bookmarkState === 'saved' ? (
                            <>
                              <Star className="h-3.5 w-3.5" />
                              Kaydedildi
                            </>
                          ) : bookmarkState === 'error' ? (
                            'Tekrar dene'
                          ) : (
                            'Kaydet / Favori'
                          )}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}

            {!isLoading && !error && result ? (
              <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3">
                <span className="text-xs text-[var(--secondary)]">
                  Sayfa {uiState.page} / {totalPages}
                  {result.latency_ms ? ` | ${result.latency_ms} ms` : ''}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={uiState.page <= 1}
                    onClick={() => applyState({ ...uiState, page: uiState.page - 1 })}
                  >
                    Onceki
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={uiState.page >= totalPages}
                    onClick={() => applyState({ ...uiState, page: uiState.page + 1 })}
                  >
                    Sonraki
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 xl:sticky xl:top-24 xl:h-fit">
          <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Sonuc Detayi</h2>
          {detailLoading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Detay yukleniyor...
            </div>
          ) : null}
          {!detailLoading && detailError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{detailError}</div>
          ) : null}
          {!detailLoading && !detailError && detail ? (
            <div className="space-y-3 text-sm">
              <h3 className="text-base font-semibold text-[var(--text)]">{detail.title}</h3>
              <p className="text-[var(--secondary)]">Kaynak: {detail.source_name}</p>
              <p className="text-[var(--secondary)]">Mahkeme: {detail.court ?? '-'} / {detail.chamber ?? '-'}</p>
              <p className="text-[var(--secondary)]">Tarih: {formatDate(detail.decision_date ?? detail.publish_date)}</p>
              <p className="text-[var(--secondary)]">
                E/K: {detail.esas_no ?? '-'} / {detail.karar_no ?? '-'}
              </p>
              <a href={detail.url_original} target="_blank" rel="noreferrer noopener" className="text-[var(--primary)] underline">
                Orijinal URL
              </a>
              <div className="rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface),var(--bg)_8%)] p-3 text-[var(--secondary)]">
                {detail.full_text ?? detail.snippet}
              </div>
            </div>
          ) : null}
          {!detailLoading && !detailError && !detail ? (
            <p className="text-sm text-[var(--secondary)]">
              Sonuc kartinda <strong>Detay</strong> butonuna basarak bu paneli acin.
            </p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
