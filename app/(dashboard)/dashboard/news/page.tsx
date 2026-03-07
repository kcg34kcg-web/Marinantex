'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type {
  DashboardNewsPayload,
  LiveNewsItem,
  NewsCategory,
  NewsSeverity,
  NewsSourceHealth,
  WorkspaceTag,
} from '@/lib/news/types';

const REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const NEWS_REQUEST_TIMEOUT_MS = 30000;
const ALL_FILTER = 'all';
const MIN_DETAIL_SENTENCE_COUNT = 5;
const ACTION_TEMPLATE_SENTENCE_HINTS = [
  'kaynakmetniacvedegisikliginkapsaminidogrula',
  'etkilenendosyalardagorevacipsorumlukisiyeata',
  'emsalkararilgili',
  'yururluktarihinidosyatakvimineislevesontarihleri',
  'muvekkilveriuyumlistesinderisktaramasiniyenile',
  'muvekkilebilgilendirmetaslagihazirlayiponayagonder',
] as const;

const WORKSPACE_LABELS: Record<WorkspaceTag, string> = {
  icra: 'Icra',
  is: 'Is',
  kira: 'Kira',
  ceza: 'Ceza',
  kvkk: 'KVKK',
  finans: 'Finans',
  eticaret: 'E-Ticaret',
  enerji: 'Enerji',
};

const CATEGORY_VARIANTS: Record<NewsCategory, BadgeVariant> = {
  Mevzuat: 'blue',
  Duyuru: 'muted',
  Ictihat: 'orange',
  Sektorel: 'outline',
};

const SEVERITY_VARIANTS: Record<NewsSeverity, BadgeVariant> = {
  kritik: 'critical',
  orta: 'warning',
  bilgi: 'muted',
};

const DEFAULT_KEYWORDS = ['kira artisi', 'isten cikarma', 'kisisel veri ihlali', 'ticari faiz', 'teminat mektubu'];
const CATEGORY_CHIPS: Array<{ id: NewsCategory | typeof ALL_FILTER; label: string }> = [
  { id: ALL_FILTER, label: 'Tum Basliklar' },
  { id: 'Mevzuat', label: 'Mevzuat' },
  { id: 'Ictihat', label: 'Ictihat' },
  { id: 'Duyuru', label: 'Duyuru' },
  { id: 'Sektorel', label: 'Sektorel' },
];

function normalize(text: string) {
  return text.toLocaleLowerCase('tr-TR');
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function transportLabel(transport: NewsSourceHealth['transport']) {
  if (transport === 'rss') {
    return 'RSS';
  }
  return 'X arayuzu';
}

function severityLabel(severity: NewsSeverity) {
  if (severity === 'kritik') {
    return 'Kritik';
  }
  if (severity === 'orta') {
    return 'Orta';
  }
  return 'Bilgi';
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function normalizeSentence(sentence: string) {
  const trimmed = sentence.trim();
  if (!trimmed) return '';
  if (/[.!?]$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
}

function compactTextForCompare(text: string) {
  return normalize(text).replace(/[^a-z0-9]+/gi, '');
}

function isTemplateActionSentence(sentence: string) {
  const compact = compactTextForCompare(sentence);
  if (!compact) {
    return false;
  }
  return ACTION_TEMPLATE_SENTENCE_HINTS.some((hint) => compact.includes(hint));
}

function buildDetailText(item: LiveNewsItem, minSentences = MIN_DETAIL_SENTENCE_COUNT) {
  const candidates = [
    ...splitSentences(item.detailText),
    ...splitSentences(item.summary),
    ...item.highlights.map((point) => normalizeSentence(point)),
  ];
  const seen = new Set<string>();
  const selected: string[] = [];

  for (const candidate of candidates) {
    const sentence = normalizeSentence(candidate);
    if (!sentence || isTemplateActionSentence(sentence)) continue;
    const key = compactTextForCompare(sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(sentence);
  }

  const fallbackSentences = [
    `Bu kayit ${item.category} kategorisinde siniflandirildi.`,
    `Onem seviyesi ${severityLabel(item.severity)} olarak kaydedildi.`,
    `Kaynak ${item.source} olarak belirtiliyor.`,
    item.workspaces.length > 0
      ? `Ilgili calisma alanlari: ${item.workspaces.map((workspace) => WORKSPACE_LABELS[workspace]).join(', ')}.`
      : '',
    item.tags.length > 0 ? `One cikan etiketler: ${item.tags.slice(0, 6).join(', ')}.` : '',
  ];

  for (const fallback of fallbackSentences) {
    if (selected.length >= minSentences) break;
    const sentence = normalizeSentence(fallback);
    if (!sentence || isTemplateActionSentence(sentence)) continue;
    const key = compactTextForCompare(sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(sentence);
  }

  if (selected.length === 0) {
    return normalizeSentence(item.detailText || item.summary);
  }

  return selected.join(' ');
}

function firstSentences(text: string, count: number) {
  const sentences = splitSentences(text);
  if (sentences.length <= count) return text.trim();
  return sentences.slice(0, count).join(' ');
}

function buildAiPanelSummary(item: LiveNewsItem) {
  const candidates = [
    ...splitSentences(item.summary),
    ...item.highlights.slice(0, 3),
    ...splitSentences(item.detailText).slice(0, 2),
  ];
  const seen = new Set<string>();
  const selected: string[] = [];

  for (const candidate of candidates) {
    if (isTemplateActionSentence(candidate)) {
      continue;
    }
    const compact = normalize(candidate).replace(/[^a-z0-9]+/gi, '');
    if (!compact || seen.has(compact)) {
      continue;
    }
    seen.add(compact);
    selected.push(candidate);
    if (selected.length >= 4) {
      break;
    }
  }

  return selected.join(' ');
}

function truncateText(text: string, maxLength = 240) {
  const normalizedText = text.trim();
  if (normalizedText.length <= maxLength) {
    return normalizedText;
  }
  return `${normalizedText.slice(0, Math.max(maxLength - 3, 0))}...`;
}

export default function DashboardNewsPage() {
  const [items, setItems] = useState<LiveNewsItem[]>([]);
  const [sources, setSources] = useState<NewsSourceHealth[]>([]);
  const [followupKeywords, setFollowupKeywords] = useState<string[]>(DEFAULT_KEYWORDS);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<NewsCategory | typeof ALL_FILTER>(ALL_FILTER);
  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceTag | typeof ALL_FILTER>(ALL_FILTER);
  const [severityFilter, setSeverityFilter] = useState<NewsSeverity | typeof ALL_FILTER>(ALL_FILTER);
  const [trustedOnly, setTrustedOnly] = useState(true);
  const [keywordFilter, setKeywordFilter] = useState<string | typeof ALL_FILTER>(ALL_FILTER);
  const [notificationMode, setNotificationMode] = useState<'anlik-kritik' | 'gunluk' | 'haftalik'>('gunluk');

  const [readIds, setReadIds] = useState<string[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [expandedSummaryId, setExpandedSummaryId] = useState<string | null>(null);
  const [mutedTags, setMutedTags] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadNews = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setLoadError(null);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), NEWS_REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch('/api/dashboard/news/stream?limit=120', {
          cache: 'no-store',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const payload = (await response.json()) as DashboardNewsPayload & { error?: string };

      if (!response.ok || !payload.items) {
        throw new Error(payload.error ?? 'Haber akisi alinamadi.');
      }

      setItems(payload.items);
      setSources(payload.sources ?? []);
      setFollowupKeywords(payload.followupKeywords?.length ? payload.followupKeywords : DEFAULT_KEYWORDS);
      setLastSyncedAt(payload.generatedAt ?? new Date().toISOString());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setLoadError('Haber akisi zaman asimina ugradi. Lutfen tekrar deneyin.');
      } else {
        setLoadError(error instanceof Error ? error.message : 'Haber akisi alinamadi.');
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadNews(false).catch(() => undefined);
    const timer = setInterval(() => {
      loadNews(true).catch(() => undefined);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadNews]);

  useEffect(() => {
    if (!actionMessage) {
      return;
    }

    const timer = setTimeout(() => {
      setActionMessage(null);
    }, 4000);

    return () => clearTimeout(timer);
  }, [actionMessage]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (trustedOnly && !item.isWhitelistedSource) {
        return false;
      }

      if (categoryFilter !== ALL_FILTER && item.category !== categoryFilter) {
        return false;
      }

      if (workspaceFilter !== ALL_FILTER && !item.workspaces.includes(workspaceFilter)) {
        return false;
      }

      if (severityFilter !== ALL_FILTER && item.severity !== severityFilter) {
        return false;
      }

      if (keywordFilter !== ALL_FILTER) {
        const keyword = normalize(keywordFilter);
        const keywordMatch =
          normalize(item.title).includes(keyword) ||
          normalize(item.summary).includes(keyword) ||
          normalize(item.detailText).includes(keyword) ||
          item.tags.some((tag) => normalize(tag).includes(keyword));

        if (!keywordMatch) {
          return false;
        }
      }

      if (mutedTags.length > 0 && item.tags.some((tag) => mutedTags.includes(tag))) {
        return false;
      }

      const q = normalize(search.trim());
      if (!q) {
        return true;
      }

      const haystack = `${item.title} ${item.summary} ${item.detailText} ${item.source} ${item.tags.join(' ')}`;
      return normalize(haystack).includes(q);
    });
  }, [items, categoryFilter, keywordFilter, mutedTags, search, severityFilter, trustedOnly, workspaceFilter]);

  const healthySourceCount = useMemo(() => sources.filter((source) => source.success).length, [sources]);
  const totalSourceCount = sources.length;
  const unreadCount = useMemo(
    () => filteredItems.filter((item) => !readIds.includes(item.id)).length,
    [filteredItems, readIds],
  );

  function toggleRead(id: string) {
    setReadIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  function toggleSave(id: string) {
    setSavedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  async function shareItem(item: LiveNewsItem) {
    try {
      await navigator.clipboard.writeText(`${item.title} - ${item.sourceUrl}`);
      setActionMessage('Baglanti panoya kopyalandi.');
    } catch {
      setActionMessage('Baglanti kopyalanamadi.');
    }
  }

  function addToCase(item: LiveNewsItem) {
    setActionMessage(`"${item.title}" secilen dosyaya eklendi.`);
  }

  function openTasksForImpactedCases(item: LiveNewsItem) {
    const impactedCount = item.impactCases.length;
    if (impactedCount === 0) {
      setActionMessage('Bu haber icin etkilenen dosya onerisi bulunmuyor.');
      return;
    }

    setActionMessage(`${impactedCount} dosya icin inceleme gorevi olusturuldu.`);
  }

  function muteTagForThirtyDays(tag: string) {
    setMutedTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    setActionMessage(`"${tag}" etiketi 30 gun sessize alindi.`);
  }

  return (
    <section className="space-y-4">
      <Card className="overflow-hidden border-[var(--border)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface),white_20%)_0%,var(--surface)_100%)] shadow-sm">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Haber Akisi</h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--secondary)]">
                Hukuki gelismeler sade bir akis icinde listelenir. Ozet, detay ve kaynak baglantisi her kayitta birlikte yer alir.
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={isRefreshing} onClick={() => loadNews(true)}>
              {isRefreshing ? 'Yenileniyor...' : 'Akisi Yenile'}
            </Button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--secondary)]">Kaynak</p>
              <p className="text-sm font-medium text-[var(--text)]">
                {healthySourceCount} / {totalSourceCount}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--secondary)]">Gorunen</p>
              <p className="text-sm font-medium text-[var(--text)]">{filteredItems.length}</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--secondary)]">Okunmamis</p>
              <p className="text-sm font-medium text-[var(--text)]">{unreadCount}</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/70 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--secondary)]">Son Senkron</p>
              <p className="text-sm font-medium text-[var(--text)]">{formatDateTime(lastSyncedAt)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-[var(--border)] shadow-sm">
        <CardContent className="space-y-3 p-4">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ara: kanun, teblig, kvkk, yargitay..."
          />

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select
              value={workspaceFilter}
              onChange={(event) => setWorkspaceFilter(event.target.value as WorkspaceTag | typeof ALL_FILTER)}
              className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
            >
              <option value={ALL_FILTER}>Calisma alani: tumu</option>
              {(Object.keys(WORKSPACE_LABELS) as WorkspaceTag[]).map((workspace) => (
                <option key={workspace} value={workspace}>
                  {WORKSPACE_LABELS[workspace]}
                </option>
              ))}
            </select>

            <select
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value as NewsSeverity | typeof ALL_FILTER)}
              className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
            >
              <option value={ALL_FILTER}>Onem seviyesi: tumu</option>
              <option value="kritik">Kritik</option>
              <option value="orta">Orta</option>
              <option value="bilgi">Bilgi</option>
            </select>

            <select
              value={keywordFilter}
              onChange={(event) => setKeywordFilter(event.target.value)}
              className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
            >
              <option value={ALL_FILTER}>Anahtar kelime: tumu</option>
              {followupKeywords.map((keyword) => (
                <option key={keyword} value={keyword}>
                  {keyword}
                </option>
              ))}
            </select>

            <Button
              type="button"
              size="sm"
              variant={trustedOnly ? 'default' : 'outline'}
              onClick={() => setTrustedOnly((prev) => !prev)}
              className="h-10"
            >
              {trustedOnly ? 'Sadece guvenilir' : 'Tum kaynaklar'}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {CATEGORY_CHIPS.map((chip) => {
              const isActive = categoryFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setCategoryFilter(chip.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    isActive
                      ? 'border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary),transparent_88%)] text-[var(--primary)]'
                      : 'border-[var(--border)] text-[var(--secondary)] hover:text-[var(--text)]'
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {actionMessage ? (
        <div className="rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface),var(--primary)_4%)] px-3 py-2 text-xs text-[var(--secondary)]">
          {actionMessage}
        </div>
      ) : null}

      {loadError ? (
        <Card className="border-[var(--border)]">
          <CardContent className="pt-6">
            <p className="text-sm text-orange-600">{loadError}</p>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <Card className="border-[var(--border)]">
          <CardContent className="pt-6">
            <p className="text-sm text-[var(--secondary)]">Canli haber akisi yukleniyor...</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredItems.length === 0 ? (
            <Card className="border-[var(--border)]">
              <CardContent className="pt-6">
                <p className="text-sm text-[var(--secondary)]">Bu filtrelerle eslesen haber bulunamadi.</p>
              </CardContent>
            </Card>
          ) : (
            filteredItems.map((item) => {
              const isRead = readIds.includes(item.id);
              const isSaved = savedIds.includes(item.id);
              const isSummaryExpanded = expandedSummaryId === item.id;
              const aiPanelSummary = buildAiPanelSummary(item);
              const detailText = buildDetailText(item);
              const detailPreview = firstSentences(detailText, MIN_DETAIL_SENTENCE_COUNT);

              return (
                <Card key={item.id} className="border-[var(--border)] bg-[var(--surface)] shadow-sm">
                  <CardHeader className="space-y-2 pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={CATEGORY_VARIANTS[item.category]}>{item.category}</Badge>
                        <Badge variant={SEVERITY_VARIANTS[item.severity]}>{severityLabel(item.severity)}</Badge>
                        <Badge variant={isRead ? 'outline' : 'success'}>{isRead ? 'Okundu' : 'Yeni'}</Badge>
                      </div>
                      <p className="text-[11px] text-[var(--secondary)]">{formatDateTime(item.publishedAt)}</p>
                    </div>
                    <CardTitle className="text-[17px] leading-snug">{item.title}</CardTitle>
                    <CardDescription>{item.source}</CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    <div className="rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface),var(--primary)_3%)] p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--secondary)]">Kisa Ozet</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--text)]">{item.summary}</p>
                    </div>

                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--secondary)]">Detay</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--secondary)]">
                        {isSummaryExpanded ? detailText : detailPreview}
                      </p>
                    </div>

                    {item.highlights.length > 0 ? (
                      <ul className="flex flex-wrap gap-1.5">
                        {Array.from(new Set(item.highlights))
                          .slice(0, 3)
                          .map((point, index) => (
                            <li
                              key={`${item.id}-highlight-${index}`}
                              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--secondary)]"
                            >
                              {truncateText(point, 90)}
                            </li>
                          ))}
                      </ul>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => toggleRead(item.id)}>
                        {isRead ? 'Okunmamis Yap' : 'Okundu'}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => toggleSave(item.id)}>
                        {isSaved ? 'Kaydi Kaldir' : 'Kaydet'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setExpandedSummaryId((prev) => (prev === item.id ? null : item.id))}
                      >
                        {isSummaryExpanded ? 'Detayi Kapat' : 'Detay ve Yapay Ozet'}
                      </Button>
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-[36px] items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--surface),var(--primary)_8%)]"
                      >
                        Kaynaga Git
                      </a>
                    </div>

                    {isSummaryExpanded ? (
                      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface),var(--primary)_3%)] p-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--secondary)]">Yapay Ozet</p>
                          <p className="mt-1 text-sm leading-6 text-[var(--text)]">{aiPanelSummary}</p>
                        </div>

                        {item.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {item.tags.slice(0, 6).map((tag) => (
                              <button
                                key={`${item.id}-${tag}`}
                                type="button"
                                onClick={() => muteTagForThirtyDays(tag)}
                                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--secondary)] hover:text-[var(--text)]"
                                title="Bu etiketi 30 gun sessize al"
                              >
                                #{tag}
                              </button>
                            ))}
                          </div>
                        ) : null}

                        {item.impactCases.length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--secondary)]">Etkilenen Dosyalar</p>
                            <ul className="space-y-1 text-xs text-[var(--secondary)]">
                              {item.impactCases.map((affected) => (
                                <li key={`${item.id}-${affected.id}`}>
                                  <span className="font-medium text-[var(--text)]">{affected.title}</span> | {affected.reason}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => shareItem(item)}>
                            Paylas
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => addToCase(item)}>
                            Dosyaya Ekle
                          </Button>
                          {item.impactCases.length > 0 ? (
                            <Button type="button" size="sm" onClick={() => openTasksForImpactedCases(item)}>
                              Gorev Ac
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      <Card className="border-[var(--border)] shadow-sm">
        <CardContent className="p-4">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-[var(--text)]">
              Kaynak Sagligi ve Bildirim Ayarlari
            </summary>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs text-[var(--secondary)]">Bildirim modu</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setNotificationMode('anlik-kritik')}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      notificationMode === 'anlik-kritik'
                        ? 'border-[var(--primary)] text-[var(--primary)]'
                        : 'border-[var(--border)] text-[var(--secondary)]'
                    }`}
                  >
                    Anlik kritik
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotificationMode('gunluk')}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      notificationMode === 'gunluk'
                        ? 'border-[var(--primary)] text-[var(--primary)]'
                        : 'border-[var(--border)] text-[var(--secondary)]'
                    }`}
                  >
                    Gunluk
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotificationMode('haftalik')}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      notificationMode === 'haftalik'
                        ? 'border-[var(--primary)] text-[var(--primary)]'
                        : 'border-[var(--border)] text-[var(--secondary)]'
                    }`}
                  >
                    Haftalik
                  </button>
                </div>
              </div>

              <div className="max-h-[220px] space-y-2 overflow-y-auto">
                {sources.map((source) => (
                  <div key={source.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-2.5 py-2">
                    <div>
                      <p className="text-xs font-medium text-[var(--text)]">{source.name}</p>
                      <p className="text-[11px] text-[var(--secondary)]">
                        {transportLabel(source.transport)} | {source.latencyMs} ms
                      </p>
                    </div>
                    <Badge variant={source.success ? 'success' : 'critical'}>
                      {source.success ? `${source.itemCount} kayit` : 'Hata'}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </CardContent>
      </Card>
    </section>
  );
}
