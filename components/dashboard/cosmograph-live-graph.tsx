'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { format, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';

import { Cosmograph, type CosmographRef } from '@cosmograph/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  bundleExportManifestSchema,
  graphNeighborhoodPayloadSchema,
  graphPayloadSchema,
  type BundleExportManifest,
  type GraphNeighborhoodPayload,
  type GraphPayload,
} from '@/lib/litigation/graph';

type RelationFilter = 'all' | 'contradiction' | 'entailment' | 'neutral';

interface GraphServerFilters {
  minSimilarity: number;
  maxEdges: number;
}

async function fetchGraphData(caseId: string, filters: GraphServerFilters): Promise<GraphPayload> {
  const query = new URLSearchParams({
    minSimilarity: String(filters.minSimilarity),
    maxEdges: String(filters.maxEdges),
  });

  const response = await fetch(`/api/litigation/cases/${caseId}/graph?${query.toString()}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Graf verisi alınamadı.');
  }

  const json = await response.json();
  return graphPayloadSchema.parse(json);
}

async function fetchNeighborhoodData(caseId: string, nodeId: string): Promise<GraphNeighborhoodPayload> {
  const response = await fetch(
    `/api/litigation/cases/${caseId}/graph/neighborhood?nodeId=${encodeURIComponent(nodeId)}`,
    {
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw new Error('Komşuluk verisi alınamadı.');
  }

  const json = await response.json();
  return graphNeighborhoodPayloadSchema.parse(json);
}

async function generateBundleManifest(caseId: string): Promise<BundleExportManifest> {
  const response = await fetch(`/api/litigation/cases/${caseId}/bundle-export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error('Bundle manifest üretilemedi.');
  }

  const json = await response.json();
  return bundleExportManifestSchema.parse(json);
}

interface WorkerLayoutResult {
  ids: string[];
  coords: ArrayBuffer;
  meta: {
    iterations: number;
    durationMs: number;
    nodeCount: number;
    edgeCount: number;
  };
}

export function CosmographLiveGraph({ caseId }: { caseId: string }) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const contradictionsRef = useRef<HTMLDivElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const cosmographRef = useRef<CosmographRef>(undefined);
  const graphRebuildWaitersRef = useRef<Array<() => void>>([]);
  const [layoutNodes, setLayoutNodes] = useState<Record<string, { x: number; y: number }>>({});
  const [layoutMeta, setLayoutMeta] = useState<WorkerLayoutResult['meta'] | null>(null);
  const [timeIndex, setTimeIndex] = useState(0);
  const [relationFilter, setRelationFilter] = useState<RelationFilter>('all');
  const [exportLayer, setExportLayer] = useState<RelationFilter>('all');
  const [pendingMinSimilarity, setPendingMinSimilarity] = useState('0.35');
  const [pendingMaxEdges, setPendingMaxEdges] = useState('3000');
  const [serverFilters, setServerFilters] = useState<GraphServerFilters>({
    minSimilarity: 0.35,
    maxEdges: 3000,
  });
  const [bundleManifest, setBundleManifest] = useState<BundleExportManifest | null>(null);
  const [isBundleLoading, setIsBundleLoading] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [lookupNodeId, setLookupNodeId] = useState('');
  const [neighborhood, setNeighborhood] = useState<GraphNeighborhoodPayload | null>(null);
  const [isNeighborhoodLoading, setIsNeighborhoodLoading] = useState(false);
  const [neighborhoodError, setNeighborhoodError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['litigation-graph', caseId, serverFilters.minSimilarity, serverFilters.maxEdges],
    queryFn: () => fetchGraphData(caseId, serverFilters),
  });

  useEffect(() => {
    workerRef.current = new Worker(new URL('./graph-layout.worker.ts', import.meta.url));

    const handleMessage = (event: MessageEvent<WorkerLayoutResult>) => {
      const next: Record<string, { x: number; y: number }> = {};
      const coords = new Float32Array(event.data.coords);
      for (let i = 0; i < event.data.ids.length; i += 1) {
        const id = event.data.ids[i];
        next[id] = {
          x: coords[i * 2] ?? 0,
          y: coords[i * 2 + 1] ?? 0,
        };
      }
      setLayoutNodes(next);
      setLayoutMeta(event.data.meta ?? null);
    };

    workerRef.current.addEventListener('message', handleMessage);

    return () => {
      workerRef.current?.removeEventListener('message', handleMessage);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!data || !workerRef.current) {
      return;
    }

    workerRef.current.postMessage({
      nodes: data.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
      links: data.links.map((link) => ({ source: link.source, target: link.target })),
      width: 1200,
      height: 700,
      iterations: data.nodes.length > 5000 ? 40 : data.nodes.length > 1500 ? 70 : 100,
      frameBudgetMs: data.nodes.length > 5000 ? 10 : data.nodes.length > 1500 ? 14 : 20,
    });
  }, [data]);

  const timelineDates = useMemo(() => {
    if (!data) {
      return [] as string[];
    }

    const set = new Set<string>();
    for (const node of data.nodes) {
      if (node.factualOccurrenceDate) {
        set.add(node.factualOccurrenceDate);
      }
    }

    return [...set].sort((left, right) => left.localeCompare(right));
  }, [data]);

  useEffect(() => {
    if (timelineDates.length === 0) {
      setTimeIndex(0);
      return;
    }

    setTimeIndex(timelineDates.length - 1);
  }, [timelineDates]);

  const selectedDate = timelineDates[timeIndex] ?? null;

  const formatTurkishDate = (value: string | null) => {
    if (!value) {
      return '-';
    }

    try {
      return format(parseISO(value), 'dd.MM.yyyy', { locale: tr });
    } catch {
      return value;
    }
  };

  const toNullableString = (value: unknown): string | null => {
    return typeof value === 'string' && value.length > 0 ? value : null;
  };

  const temporalNodeIds = useMemo(() => {
    if (!data) {
      return new Set<string>();
    }

    if (!selectedDate) {
      return new Set(data.nodes.map((node) => node.id));
    }

    return new Set(
      data.nodes
        .filter((node) => !node.factualOccurrenceDate || node.factualOccurrenceDate <= selectedDate)
        .map((node) => node.id),
    );
  }, [data, selectedDate]);

  const graphNodes = useMemo(() => {
    if (!data) {
      return [] as Array<Record<string, string | number | null>>;
    }

    return data.nodes
      .filter((node) => temporalNodeIds.has(node.id))
      .map((node) => ({
        id: node.id,
        label: node.label,
        factualOccurrenceDate: node.factualOccurrenceDate,
        epistemicDiscoveryDate: node.epistemicDiscoveryDate,
        x: layoutNodes[node.id]?.x ?? node.x,
        y: layoutNodes[node.id]?.y ?? node.y,
      }));
  }, [data, layoutNodes, temporalNodeIds]);

  const graphLinks = useMemo(() => {
    if (!data) {
      return [] as Array<Record<string, string | number>>;
    }

    return data.links
      .filter((link) => temporalNodeIds.has(link.source) && temporalNodeIds.has(link.target))
      .filter((link) => relationFilter === 'all' || link.relation === relationFilter)
      .map((link) => ({
        id: link.id,
        source: link.source,
        target: link.target,
        relation: link.relation,
        weight: link.weight,
      }));
  }, [data, relationFilter, temporalNodeIds]);

  const contradictionRows = useMemo(() => {
    return graphLinks.filter((link) => String(link.relation) === 'contradiction');
  }, [graphLinks]);

  const handleLoadNeighborhood = async () => {
    const nodeId = lookupNodeId.trim();
    if (!nodeId) {
      setNeighborhoodError('Lütfen bir düğüm kimliği girin.');
      setNeighborhood(null);
      return;
    }

    setIsNeighborhoodLoading(true);
    setNeighborhoodError(null);

    try {
      const result = await fetchNeighborhoodData(caseId, nodeId);
      setNeighborhood(result);
    } catch {
      setNeighborhood(null);
      setNeighborhoodError('Komşuluk getirilemedi. Düğüm kimliğini kontrol edin.');
    } finally {
      setIsNeighborhoodLoading(false);
    }
  };

  const handleApplyServerFilters = () => {
    const minSimilarity = Number(pendingMinSimilarity);
    const maxEdges = Number(pendingMaxEdges);

    if (!Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 1) {
      return;
    }

    if (!Number.isFinite(maxEdges) || maxEdges < 1 || maxEdges > 10000) {
      return;
    }

    setServerFilters({
      minSimilarity,
      maxEdges: Math.floor(maxEdges),
    });
  };

  const handleGenerateBundleManifest = async () => {
    setIsBundleLoading(true);
    setBundleError(null);

    try {
      const manifest = await generateBundleManifest(caseId);
      setBundleManifest(manifest);
    } catch {
      setBundleManifest(null);
      setBundleError('Bundle manifest üretimi başarısız oldu.');
    } finally {
      setIsBundleLoading(false);
    }
  };

  const downloadBlob = (fileName: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const escapeCsvCell = (value: unknown) => {
    if (value === null || value === undefined) {
      return '';
    }
    const raw = String(value);
    const needsQuotes = raw.includes(',') || raw.includes('\n') || raw.includes('"') || raw.includes('\r');
    const escaped = raw.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  };

  const toCsv = (rows: Array<Record<string, unknown>>, columns: string[]) => {
    const header = columns.join(',');
    const lines = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(','));
    return [header, ...lines].join('\n');
  };

  const handleExportPng = () => {
    const selectedDateSafe = selectedDate ? selectedDate.replaceAll(':', '-') : 'tum-zamanlar';
    const filename = `dosya-${caseId}-graf-${selectedDateSafe}-${relationFilter}.png`;
    try {
      cosmographRef.current?.captureScreenshot?.(filename);
    } catch {
      // Intentionally swallow: screenshot is best-effort (WebGL buffer limitations).
    }
  };

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const waitForGraphRebuild = (timeoutMs = 2000) =>
    new Promise<boolean>((resolve) => {
      let finished = false;
      const finish = (ok: boolean) => {
        if (finished) {
          return;
        }
        finished = true;
        resolve(ok);
      };

      const waiter = () => finish(true);
      graphRebuildWaitersRef.current.push(waiter);

      window.setTimeout(() => {
        graphRebuildWaitersRef.current = graphRebuildWaitersRef.current.filter((item) => item !== waiter);
        finish(false);
      }, timeoutMs);
    });

  useEffect(() => {
    return () => {
      graphRebuildWaitersRef.current = [];
    };
  }, []);

  const handleExportLayerPngs = async () => {
    const selectedDateSafe = selectedDate ? selectedDate.replaceAll(':', '-') : 'tum-zamanlar';
    const originalFilter = relationFilter;

    const layers: Array<'all' | 'contradiction' | 'entailment' | 'neutral'> = [
      'all',
      'contradiction',
      'entailment',
      'neutral',
    ];

    try {
      for (const layer of layers) {
        setRelationFilter(layer);

        // Let React update + Cosmograph rebuild before capturing.
        await nextFrame();
        await waitForGraphRebuild(2500);
        await nextFrame();

        const filename = `dosya-${caseId}-graf-${selectedDateSafe}-layer-${layer}.png`;
        cosmographRef.current?.captureScreenshot?.(filename);

        // Small delay to avoid blocking the UI thread.
        await wait(80);
      }
    } finally {
      setRelationFilter(originalFilter);
    }
  };

  const handleExportJson = () => {
    const selectedDateSafe = selectedDate ? selectedDate.replaceAll(':', '-') : 'tum-zamanlar';
    const base = `dosya-${caseId}-graf-${selectedDateSafe}-${relationFilter}`;

    downloadBlob(`${base}-nodes.json`, new Blob([JSON.stringify(graphNodes, null, 2)], { type: 'application/json' }));
    downloadBlob(`${base}-links.json`, new Blob([JSON.stringify(graphLinks, null, 2)], { type: 'application/json' }));
  };

  const handleExportLayerCsv = () => {
    const selectedDateSafe = selectedDate ? selectedDate.replaceAll(':', '-') : 'tum-zamanlar';
    const layer = exportLayer;
    const links = (graphLinks as Array<Record<string, unknown>>).filter(
      (link) => layer === 'all' || String(link.relation) === layer,
    );
    const nodes = graphNodes as Array<Record<string, unknown>>;

    const base = `dosya-${caseId}-graf-${selectedDateSafe}-layer-${layer}`;

    const nodesCsv = toCsv(nodes, ['id', 'label', 'factualOccurrenceDate', 'epistemicDiscoveryDate', 'x', 'y']);
    const linksCsv = toCsv(links, ['id', 'source', 'target', 'relation', 'weight']);

    downloadBlob(`${base}-nodes.csv`, new Blob([nodesCsv], { type: 'text/csv;charset=utf-8' }));
    downloadBlob(`${base}-links.csv`, new Blob([linksCsv], { type: 'text/csv;charset=utf-8' }));
  };

  const rowVirtualizer = useVirtualizer({
    count: graphNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 42,
    overscan: 10,
  });

  const contradictionVirtualizer = useVirtualizer({
    count: contradictionRows.length,
    getScrollElement: () => contradictionsRef.current,
    estimateSize: () => 38,
    overscan: 8,
  });

  const items = rowVirtualizer.getVirtualItems();
  const contradictionItems = contradictionVirtualizer.getVirtualItems();

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <CardTitle>Cosmograph 5D Zaman Grafı</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleExportPng}>
                PNG Dışa Aktar
              </Button>
              <Button type="button" variant="outline" onClick={handleExportJson}>
                JSON Dışa Aktar
              </Button>
              <Button type="button" variant="outline" onClick={handleGenerateBundleManifest} disabled={isBundleLoading}>
                {isBundleLoading ? 'Manifest üretiliyor...' : 'Bundle Manifest'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {bundleError ? <p className="mb-3 text-xs text-orange-700">{bundleError}</p> : null}

          {bundleManifest ? (
            <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
              <p>
                Bundle SHA-256: <strong>{bundleManifest.finalBundleSha256.slice(0, 16)}...</strong>
              </p>
              <p>
                Merkle: <strong>{bundleManifest.merkleRoot.slice(0, 16)}...</strong> · Chain:{' '}
                <strong>{bundleManifest.chainHash.slice(0, 16)}...</strong>
              </p>
              <p>
                Kapsam: <strong>{bundleManifest.nodeCount}</strong> düğüm / <strong>{bundleManifest.linkCount}</strong>{' '}
                kenar / <strong>{bundleManifest.batesCount}</strong> bates
              </p>
            </div>
          ) : null}

          <div className="mb-3 grid gap-2 md:grid-cols-[1fr_220px]">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Zaman Kaydırıcı (Factual Date)</p>
              <input
                type="range"
                min={0}
                max={Math.max(0, timelineDates.length - 1)}
                value={Math.min(timeIndex, Math.max(0, timelineDates.length - 1))}
                onChange={(event) => setTimeIndex(Number(event.target.value))}
                className="w-full"
                disabled={timelineDates.length === 0}
              />
              <p className="text-xs text-slate-500">
                Seçili tarih: {selectedDate ? formatTurkishDate(selectedDate) : 'Veri yok'}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">NLI Overlay</p>
              <select
                value={relationFilter}
                onChange={(event) => setRelationFilter(event.target.value as RelationFilter)}
                className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
              >
                <option value="all">Tümü</option>
                <option value="contradiction">Çelişki</option>
                <option value="entailment">Destekleyen</option>
                <option value="neutral">Nötr</option>
              </select>
            </div>
          </div>

          <div className="mb-3 rounded-md border border-border p-2">
            <p className="mb-2 text-xs font-semibold text-slate-700">Aday Filtreleme (Maliyet Kontrolü)</p>
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <Input
                value={pendingMinSimilarity}
                onChange={(event) => setPendingMinSimilarity(event.target.value)}
                placeholder="Min benzerlik (0-1)"
              />
              <Input
                value={pendingMaxEdges}
                onChange={(event) => setPendingMaxEdges(event.target.value)}
                placeholder="Maks kenar"
              />
              <Button type="button" variant="outline" onClick={handleApplyServerFilters}>
                Uygula
              </Button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Aktif: min={serverFilters.minSimilarity} · maxEdges={serverFilters.maxEdges}
            </p>
          </div>

          <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto]">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Katman Dışa Aktar (CSV)</p>
              <select
                value={exportLayer}
                onChange={(event) => setExportLayer(event.target.value as RelationFilter)}
                className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
              >
                <option value="all">Tüm İlişkiler</option>
                <option value="contradiction">Sadece Çelişki</option>
                <option value="entailment">Sadece Destekleyen</option>
                <option value="neutral">Sadece Nötr</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">
                İndirilen CSV; geçerli zaman dilimi + filtrelenmiş grafı baz alır.
              </p>
            </div>
            <div className="flex items-end">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={handleExportLayerPngs}>
                  Katman PNG (x4)
                </Button>
                <Button type="button" onClick={handleExportLayerCsv}>
                  Katmanı İndir
                </Button>
              </div>
            </div>
          </div>

          <p className="mb-3 text-xs text-slate-500">
            Yerleşim:{' '}
            {layoutMeta
              ? `${layoutMeta.iterations} iterasyon · ${layoutMeta.durationMs}ms · ${layoutMeta.nodeCount} düğüm / ${layoutMeta.edgeCount} kenar`
              : 'hesaplanıyor...'}
          </p>
          <p className="mb-3 text-xs text-slate-500">
            Adaylar:{' '}
            {data?.meta ? `${data.meta.totalCandidates} → ${data.meta.returnedLinks} kenar` : 'hesaplanıyor...'}
          </p>

          {isLoading ? <p className="text-sm text-slate-500">Graf yükleniyor...</p> : null}
          {isError ? <p className="text-sm text-orange-600">Graf verisi alınamadı.</p> : null}
          {!isLoading && !isError ? (
            <div className="h-[560px] rounded-md border border-border">
              <Cosmograph
                ref={cosmographRef}
                points={graphNodes}
                links={graphLinks}
                pointIdBy="id"
                pointLabelBy="label"
                pointXBy="x"
                pointYBy="y"
                linkSourceBy="source"
                linkTargetBy="target"
                linkColorBy="relation"
                onGraphRebuilt={() => {
                  const waiters = graphRebuildWaitersRef.current;
                  graphRebuildWaitersRef.current = [];
                  for (const waiter of waiters) {
                    try {
                      waiter();
                    } catch {
                      // best-effort
                    }
                  }
                }}
                showFPSMonitor
                simulationGravity={0.01}
                simulationRepulsion={0.3}
                fitViewOnInit
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Düğümler (Virtualized)</CardTitle>
        </CardHeader>
        <CardContent>
          <div ref={parentRef} className="h-[560px] overflow-auto rounded-md border border-border">
            <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
              {items.map((virtualItem) => {
                const node = graphNodes[virtualItem.index];
                if (!node) {
                  return null;
                }

                return (
                  <div
                    key={String(node.id)}
                    className="absolute left-0 top-0 w-full border-b border-border px-3 py-2 text-xs"
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    <p className="font-semibold text-slate-800">{String(node.label)}</p>
                    <p className="text-slate-500">
                      Factual: {formatTurkishDate(toNullableString(node.factualOccurrenceDate))}
                    </p>
                    <p className="text-slate-500">
                      Discovery: {formatTurkishDate(toNullableString(node.epistemicDiscoveryDate))}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3 rounded-md border border-border p-2">
            <p className="mb-2 text-xs font-semibold text-slate-700">NLI Çelişki Listesi (Virtualized)</p>
            <div ref={contradictionsRef} className="h-[180px] overflow-auto rounded-md border border-border">
              <div style={{ height: `${contradictionVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                {contradictionItems.map((virtualItem) => {
                  const row = contradictionRows[virtualItem.index];
                  if (!row) {
                    return null;
                  }

                  return (
                    <div
                      key={String(row.id)}
                      className="absolute left-0 top-0 w-full border-b border-border px-2 py-2 text-[11px]"
                      style={{ transform: `translateY(${virtualItem.start}px)` }}
                    >
                      <p className="font-semibold text-orange-700">
                        {String(row.source)} ↔ {String(row.target)}
                      </p>
                      <p className="text-slate-500">
                        İlişki: {String(row.relation)} | Skor: {String(row.weight)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-border p-2">
            <p className="mb-2 text-xs font-semibold text-slate-700">Komşuluk Sorgusu (Lazy Fetch)</p>
            <div className="flex gap-2">
              <Input
                value={lookupNodeId}
                onChange={(event) => setLookupNodeId(event.target.value)}
                placeholder="Düğüm ID"
              />
              <Button type="button" variant="outline" onClick={handleLoadNeighborhood} disabled={isNeighborhoodLoading}>
                {isNeighborhoodLoading ? 'Yükleniyor...' : 'Getir'}
              </Button>
            </div>

            {neighborhoodError ? <p className="mt-2 text-xs text-orange-700">{neighborhoodError}</p> : null}

            {neighborhood ? (
              <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                <p>
                  Merkez: <strong>{neighborhood.centerNodeId}</strong>
                </p>
                <p>
                  Düğüm: <strong>{neighborhood.nodes.length}</strong> · Kenar:{' '}
                  <strong>{neighborhood.links.length}</strong>
                </p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
