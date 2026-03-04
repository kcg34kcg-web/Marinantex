'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui-store';

export default function HukukAiFullBleedLayout({ children }: { children: React.ReactNode }) {
  const { isSidebarOpen, setSidebarOpen } = useUiStore();

  useEffect(() => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  return (
    <div
      className={cn(
        'app-main-pane fixed right-0 top-0 z-[60] h-dvh overflow-hidden bg-[var(--main-surface-0,var(--surface))]',
        isSidebarOpen ? 'left-64' : 'left-[72px]',
      )}
    >
      {children}
    </div>
  );
}
