'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Cosmograph, type CosmographRef } from '@cosmograph/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface GraphNode {
  id: string;
  label: string;
  factualOccurrenceDate: string | null;
  epistemicDiscoveryDate: string | null;
  x: number;
  y: number;
}

interface GraphLink {
  id: string;
  source: string;
  target: string;
  relation: string;
  weight: number;
}

interface GraphPayload {
  nodes: GraphNode[];
  links: GraphLink[];
}

async function fetchGraphData(caseId: string): Promise<GraphPayload> {
  const response = await fetch(`/api/litigation/cases/${caseId}/graph`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Graf verisi alınamadı.');
  }

  return (await response.json()) as GraphPayload;
}

interface WorkerLayoutResult {
  nodes: Array<{ id: string; x: number; y: number }>;
}

export function CosmographLiveGraph({ caseId }: { caseId: string }) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const contradictionsRef = useRef<HTMLDivElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const cosmographRef = useRef<CosmographRef>(undefined);
  const graphRebuildWaitersRef = useRef<Array<() => void>>([]);
  const [layoutNodes, setLayoutNodes] = useState<Record<string, { x: number; y: number }>>({});
  const [timeIndex, setTimeIndex] = useState(0);
  const [relationFilter, setRelationFilter] = useState<'all' | 'contradiction' | 'entailment' | 'neutral'>('all');
  const [exportLayer, setExportLayer] = useState<'all' | 'contradiction' | 'entailment' | 'neutral'>('all');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['litigation-graph', caseId],
    queryFn: () => fetchGraphData(caseId),
  });

  useEffect(() => {
    workerRef.current = new Worker(new URL('./graph-layout.worker.ts', import.meta.url));

    const handleMessage = (event: MessageEvent<WorkerLayoutResult>) => {
      const next: Record<string, { x: number; y: number }> = {};
      for (const item of event.data.nodes) {
        next[item.id] = { x: item.x, y: item.y };
      }
      setLayoutNodes(next);
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
      iterations: 100,
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
        .map((node) => node.id)
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
    const links = (graphLinks as Array<Record<string, unknown>>).filter((link) => layer === 'all' || String(link.relation) === layer);
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
            </div>
          </div>
        </CardHeader>
        <CardContent>
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
              <p className="text-xs text-slate-500">Seçili tarih: {selectedDate ?? 'Veri yok'}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">NLI Overlay</p>
              <select
                value={relationFilter}
                onChange={(event) => setRelationFilter(event.target.value as 'all' | 'contradiction' | 'entailment' | 'neutral')}
                className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
              >
                <option value="all">Tümü</option>
                <option value="contradiction">Çelişki</option>
                <option value="entailment">Destekleyen</option>
                <option value="neutral">Nötr</option>
              </select>
            </div>
          </div>

          <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto]">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Katman Dışa Aktar (CSV)</p>
              <select
                value={exportLayer}
                onChange={(event) => setExportLayer(event.target.value as 'all' | 'contradiction' | 'entailment' | 'neutral')}
                className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
              >
                <option value="all">Tüm İlişkiler</option>
                <option value="contradiction">Sadece Çelişki</option>
                <option value="entailment">Sadece Destekleyen</option>
                <option value="neutral">Sadece Nötr</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">İndirilen CSV; geçerli zaman dilimi + filtrelenmiş grafı baz alır.</p>
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
                    <p className="text-slate-500">Factual: {String(node.factualOccurrenceDate ?? '-')}</p>
                    <p className="text-slate-500">Discovery: {String(node.epistemicDiscoveryDate ?? '-')}</p>
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
                      <p className="font-semibold text-orange-700">{String(row.source)} ↔ {String(row.target)}</p>
                      <p className="text-slate-500">İlişki: {String(row.relation)} | Skor: {String(row.weight)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
