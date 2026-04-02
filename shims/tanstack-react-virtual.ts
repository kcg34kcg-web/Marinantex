import * as React from 'react';

interface VirtualItem {
  index: number;
  key: number;
  size: number;
  start: number;
  end: number;
}

interface UseVirtualizerOptions {
  count: number;
  estimateSize: () => number;
  getScrollElement?: () => Element | null;
  overscan?: number;
  horizontal?: boolean;
}

interface VirtualizerResult {
  getVirtualItems: () => VirtualItem[];
  getTotalSize: () => number;
  measureElement: (_element: Element | null) => void;
}

export function useVirtualizer({ count, estimateSize }: UseVirtualizerOptions): VirtualizerResult {
  const size = estimateSize();

  const items = React.useMemo<VirtualItem[]>(
    () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        size,
        start: index * size,
        end: (index + 1) * size,
      })),
    [count, size],
  );

  return {
    getVirtualItems: () => items,
    getTotalSize: () => count * size,
    measureElement: () => {},
  };
}
