'use client';

import { ChevronLeft, ChevronRight, ExternalLink, FileText, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface SplitViewSource {
  id?: string;
  doc_id?: string;
  title?: string;
  citation?: string;
  content: string;
  source_url?: string;
  source_anchor?: string;
  page_no?: number;
  char_start?: number;
  char_end?: number;
}

interface SourceSplitViewerProps {
  sources: SplitViewSource[];
  selectedIndex: number | null;
  isOpen: boolean;
  onSelect: (index: number) => void;
  onClose: () => void;
  className?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function detectPdfSource(source: SplitViewSource): boolean {
  const haystack = `${source.source_url ?? ''} ${source.title ?? ''} ${source.citation ?? ''}`.toLowerCase();
  return haystack.includes('.pdf') || haystack.includes(' pdf');
}

function buildSourceHref(source: SplitViewSource): string | null {
  const rawUrl = source.source_url?.trim();
  if (!rawUrl) return null;
  if (!detectPdfSource(source) || typeof source.page_no !== 'number') {
    return rawUrl;
  }

  if (rawUrl.includes('#page=')) {
    return rawUrl;
  }

  if (rawUrl.includes('#')) {
    return `${rawUrl}&page=${source.page_no}`;
  }

  return `${rawUrl}#page=${source.page_no}`;
}

function sourceLabel(source: SplitViewSource, index: number): string {
  return source.title ?? source.citation ?? source.id ?? source.doc_id ?? `Kaynak ${index}`;
}

function findAnchorRange(content: string, anchor?: string): { start: number; end: number } | null {
  const needle = anchor?.trim();
  if (!needle) return null;
  const index = content.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return null;
  return { start: index, end: index + needle.length };
}

function extractPreview(
  source: SplitViewSource,
): { before: string; highlight: string; after: string; hasRange: boolean } {
  const content = source.content ?? '';
  if (!content) {
    return { before: '', highlight: '', after: '', hasRange: false };
  }

  const explicitRange =
    typeof source.char_start === 'number' && typeof source.char_end === 'number'
      ? {
          start: clamp(source.char_start, 0, content.length),
          end: clamp(source.char_end, 0, content.length),
        }
      : null;
  const anchoredRange = findAnchorRange(content, source.source_anchor);
  const fallbackRange = {
    start: 0,
    end: Math.min(content.length, 280),
  };
  const selectedRange = explicitRange ?? anchoredRange ?? fallbackRange;
  const start = clamp(selectedRange.start, 0, content.length);
  const end = clamp(selectedRange.end, start, content.length);
  const hasRange = end > start;

  if (!hasRange) {
    const snippet = content.slice(0, 900);
    return { before: '', highlight: snippet, after: '', hasRange: false };
  }

  const contextWindow = 320;
  const previewStart = clamp(start - contextWindow, 0, content.length);
  const previewEnd = clamp(end + contextWindow, previewStart, content.length);

  return {
    before: content.slice(previewStart, start),
    highlight: content.slice(start, end),
    after: content.slice(end, previewEnd),
    hasRange: true,
  };
}

function TextSourceRenderer({ source }: { source: SplitViewSource }) {
  const preview = extractPreview(source);

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-600">Metin Kaynagi</p>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
        {preview.before}
        <mark className="rounded bg-yellow-200 px-0.5">{preview.highlight}</mark>
        {preview.after}
      </div>
    </div>
  );
}

function PdfSourceRenderer({ source, href }: { source: SplitViewSource; href: string | null }) {
  const preview = extractPreview(source);
  const canRenderPdf = Boolean(href);

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-600">PDF Kaynak Gorunumu</p>
      {canRenderPdf && (
        <iframe
          src={href ?? undefined}
          title={`pdf-source-${source.id ?? source.doc_id ?? 'doc'}`}
          className="h-72 w-full rounded-md border border-slate-200 bg-white"
        />
      )}
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
        {preview.before}
        <mark className="rounded bg-yellow-200 px-0.5">{preview.highlight}</mark>
        {preview.after}
      </div>
      <p className="text-[11px] text-slate-500">
        PDF renderer: Sayfa ve karakter araligina gore metin onizleme gosteriliyor.
      </p>
    </div>
  );
}

export function SourceSplitViewer({
  sources,
  selectedIndex,
  isOpen,
  onSelect,
  onClose,
  className,
}: SourceSplitViewerProps) {
  if (!isOpen) return null;

  const safeIndex =
    selectedIndex && selectedIndex >= 1 && selectedIndex <= sources.length
      ? selectedIndex
      : sources.length > 0
        ? 1
        : null;

  if (!safeIndex) {
    return null;
  }

  const source = sources[safeIndex - 1];
  const isPdf = detectPdfSource(source);
  const sourceHref = buildSourceHref(source);
  const canPrev = safeIndex > 1;
  const canNext = safeIndex < sources.length;

  return (
    <Card className={cn('h-fit border-slate-200 shadow-sm lg:sticky lg:top-4', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-blue-600" />
              Kaynak Dogrulama
            </CardTitle>
            <p className="text-xs text-slate-500">
              [{safeIndex}] {sourceLabel(source, safeIndex)}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-8 min-h-0 min-w-0 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {source.source_anchor && (
            <Badge variant="muted" className="text-xs">
              {source.source_anchor}
            </Badge>
          )}
          {typeof source.page_no === 'number' && (
            <Badge variant="muted" className="text-xs">
              Sayfa {source.page_no}
            </Badge>
          )}
          {typeof source.char_start === 'number' && typeof source.char_end === 'number' && (
            <Badge variant="muted" className="text-xs">
              Aralik: {source.char_start}-{source.char_end}
            </Badge>
          )}
          {sourceHref && (
            <a
              href={sourceHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
            >
              Kaynagi ac <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {isPdf ? <PdfSourceRenderer source={source} href={sourceHref} /> : <TextSourceRenderer source={source} />}

        <div className="flex items-center justify-between border-t border-slate-100 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canPrev}
            onClick={() => onSelect(safeIndex - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Onceki
          </Button>
          <span className="text-[11px] text-slate-500">
            {safeIndex}/{sources.length}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canNext}
            onClick={() => onSelect(safeIndex + 1)}
          >
            Sonraki
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
