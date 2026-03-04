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
const ALL_FILTER = 'all';

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
      const response = await fetch('/api/dashboard/news/stream?limit=120', { cache: 'no-store' });
      const payload = (await response.json()) as DashboardNewsPayload & { error?: string };

      if (!response.ok || !payload.items) {
        throw new Error(payload.error ?? 'Haber akisi alinamadi.');
      }

      setItems(payload.items);
      setSources(payload.sources ?? []);
      setFollowupKeywords(payload.followupKeywords?.length ? payload.followupKeywords : DEFAULT_KEYWORDS);
      setLastSyncedAt(payload.generatedAt ?? new Date().toISOString());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Haber akisi alinamadi.');
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
    <section className="space-y-5">
      <Card className="overflow-hidden border-[var(--border)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary),white_94%)_0%,color-mix(in_srgb,var(--accent),white_94%)_100%)]">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Haberler</h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--secondary)]">
                Mevzuat degisiklikleri, resmi duyurular, yargi karar ozetleri ve sektorel duzenleme gelismeleri tek akis
                icinde toplanir. Her kayit icin kaynak baglantisi, kisa ozet ve etki analizi birlikte sunulur.
              </p>
              <p className="text-xs text-[var(--secondary)]">
                Bu icerik hukuki gorus degildir. Her iddia kaynak baglantisi ile gosterilir.
              </p>
            </div>

            <div className="min-w-[240px] space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-3">
              <p className="text-xs uppercase tracking-[0.1em] text-[var(--secondary)]">Canli Durum</p>
              <p className="text-sm text-[var(--text)]">
                Kaynak sagligi: <span className="font-semibold">{healthySourceCount}</span> / {totalSourceCount}
              </p>
              <p className="text-sm text-[var(--text)]">
                Gorunen kayit: <span className="font-semibold">{filteredItems.length}</span>
              </p>
              <p className="text-sm text-[var(--text)]">
                Okunmamis: <span className="font-semibold">{unreadCount}</span>
              </p>
              <p className="text-xs text-[var(--secondary)]">Son senkron: {formatDateTime(lastSyncedAt)}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {CATEGORY_CHIPS.map((chip) => {
              const isActive = categoryFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setCategoryFilter(chip.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    isActive
                      ? 'border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary),transparent_86%)] text-[var(--primary)]'
                      : 'border-[var(--border)] bg-[var(--surface)]/70 text-[var(--secondary)] hover:text-[var(--text)]'
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}

            <Button type="button" size="sm" variant="outline" disabled={isRefreshing} onClick={() => loadNews(true)}>
              {isRefreshing ? 'Yenileniyor...' : 'Akisi Yenile'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card className="border-[var(--border)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Arama ve Kisisellestirme</CardTitle>
              <CardDescription>
                Calisma alani, onem seviyesi, anahtar kelime ve guvenilir kaynak listesi ile akis daraltilir.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ara: kira artisi, isten cikarma, veri ihlali..."
              />

              <div className="flex flex-wrap gap-2">
                <select
                  value={workspaceFilter}
                  onChange={(event) => setWorkspaceFilter(event.target.value as WorkspaceTag | typeof ALL_FILTER)}
                  className="h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]"
                >
                  <option value={ALL_FILTER}>Tum calisma alanlari</option>
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
                  <option value={ALL_FILTER}>Tum onem seviyeleri</option>
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
                >
                  {trustedOnly ? 'Sadece guvenilir kaynaklar' : 'Tum kaynaklar'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {actionMessage ? (
            <div className="rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface),var(--primary)_5%)] px-3 py-2 text-xs text-[var(--secondary)]">
              {actionMessage}
            </div>
          ) : null}

          {loadError ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-orange-600">{loadError}</p>
              </CardContent>
            </Card>
          ) : null}

          {isLoading ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-[var(--secondary)]">Canli haber akisi yukleniyor...</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredItems.length === 0 ? (
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-[var(--secondary)]">Bu filtrelerle eslesen haber bulunamadi.</p>
                  </CardContent>
                </Card>
              ) : (
                filteredItems.map((item) => {
                  const isRead = readIds.includes(item.id);
                  const isSaved = savedIds.includes(item.id);
                  const isSummaryExpanded = expandedSummaryId === item.id;

                  return (
                    <Card key={item.id} className="overflow-hidden border-[var(--border)]">
                      <CardHeader className="space-y-3 pb-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant={CATEGORY_VARIANTS[item.category]}>{item.category}</Badge>
                          <Badge variant={SEVERITY_VARIANTS[item.severity]}>{severityLabel(item.severity)}</Badge>
                          <Badge variant={isRead ? 'outline' : 'success'}>{isRead ? 'Okundu' : 'Yeni'}</Badge>
                          {item.updatedAt ? <Badge variant="outline">Guncellendi: {formatDateTime(item.updatedAt)}</Badge> : null}
                        </div>

                        <div className="space-y-1">
                          <CardTitle className="text-[17px] leading-snug">{item.title}</CardTitle>
                          <CardDescription>
                            {item.source} | {formatDateTime(item.publishedAt)}
                          </CardDescription>
                        </div>
                      </CardHeader>

                      <CardContent className="space-y-4">
                        <div className="rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface),var(--primary)_3%)] p-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--secondary)]">Kisa Ozet</p>
                          <p className="mt-1 text-sm leading-6 text-[var(--text)]">{item.summary}</p>
                        </div>

                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--secondary)]">Detay</p>
                          <p className="mt-1 text-sm leading-6 text-[var(--text)]">{item.detailText}</p>
                        </div>

                        {item.highlights.length > 0 ? (
                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--secondary)]">
                              One Cikan Basliklar
                            </p>
                            <ul className="mt-2 space-y-1 text-sm text-[var(--text)]">
                              {item.highlights.slice(0, 3).map((point) => (
                                <li key={`${item.id}-${point}`} className="flex gap-2">
                                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                                  <span>{point}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="flex flex-wrap gap-2">
                          {item.tags.map((tag) => (
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

                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => toggleRead(item.id)}>
                            {isRead ? 'Okunmamis Yap' : 'Okundu'}
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => toggleSave(item.id)}>
                            {isSaved ? 'Kaydi Kaldir' : 'Kaydet'}
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => shareItem(item)}>
                            Paylas
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => addToCase(item)}>
                            Dosyaya Ekle
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setExpandedSummaryId((prev) => (prev === item.id ? null : item.id))}
                          >
                            {isSummaryExpanded ? 'Ozeti Kapat' : 'Yapay Ozet'}
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

                        <div className="rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface),var(--primary)_4%)] p-3">
                          <p className="text-sm font-semibold text-[var(--text)]">Bizi Etkileyenler</p>
                          {item.impactCases.length === 0 ? (
                            <p className="mt-1 text-xs text-[var(--secondary)]">
                              Bu haber icin otomatik dosya eslesmesi bulunamadi.
                            </p>
                          ) : (
                            <>
                              <ul className="mt-2 space-y-1 text-xs text-[var(--secondary)]">
                                {item.impactCases.map((affected) => (
                                  <li key={`${item.id}-${affected.id}`}>
                                    <span className="font-medium text-[var(--text)]">{affected.title}</span> | {affected.reason}
                                  </li>
                                ))}
                              </ul>
                              <div className="mt-3">
                                <Button type="button" size="sm" onClick={() => openTasksForImpactedCases(item)}>
                                  Bu {item.impactCases.length} dosyaya gorev ac
                                </Button>
                              </div>
                            </>
                          )}
                        </div>

                        {isSummaryExpanded ? (
                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                            <p className="text-sm font-semibold text-[var(--text)]">Yapay Ozet ve Aksiyon Taslagi</p>
                            <p className="mt-1 text-xs text-[var(--secondary)]">
                              Guvenli mod: kaynakta olmayan iddia uretilmez; her aksiyon kaynak baglantisi ile
                              denetlenir.
                            </p>
                            <ul className="mt-2 space-y-1 text-xs text-[var(--secondary)]">
                              {item.actionDraft.map((action) => (
                                <li key={`${item.id}-${action}`}>- {action}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Bildirim Ayari</CardTitle>
              <CardDescription>Kritik degisikliklerde anlik, digerlerinde ozet bulteni akisi.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="radio"
                  name="notification-mode"
                  checked={notificationMode === 'anlik-kritik'}
                  onChange={() => setNotificationMode('anlik-kritik')}
                />
                Kritik degisikliklerde anlik bildirim
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="radio"
                  name="notification-mode"
                  checked={notificationMode === 'gunluk'}
                  onChange={() => setNotificationMode('gunluk')}
                />
                Gunluk ozet
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="radio"
                  name="notification-mode"
                  checked={notificationMode === 'haftalik'}
                  onChange={() => setNotificationMode('haftalik')}
                />
                Haftalik ozet
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Kaynak Sagligi</CardTitle>
              <CardDescription>
                Toplam {totalSourceCount} kaynak taraniyor. Basarili: {healthySourceCount}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="max-h-[320px] space-y-2 overflow-y-auto">
                {sources.map((source) => (
                  <div key={source.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-[var(--text)]">{source.name}</p>
                      <Badge variant={source.success ? 'success' : 'critical'}>
                        {source.success ? `${source.itemCount} kayit` : 'Hata'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--secondary)]">
                      {transportLabel(source.transport)} | {source.latencyMs} ms
                    </p>
                    {source.error ? <p className="mt-1 text-[11px] text-orange-600">{source.error}</p> : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Asgari Surum Kapsami</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-[var(--secondary)]">
              <p>- 20 resmi ve ilgili kaynaktan canli RSS akisi</p>
              <p>- Gerekli erisim anahtari tanimlandiginda X arayuzu cekimi</p>
              <p>- Etiketleme, arama, kaydetme ve dosyaya ekleme</p>
              <p>- Dosya etkisi esitlestirmesi ve tek tik gorev koprusu</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </section>
  );
}
