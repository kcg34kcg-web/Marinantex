'use client';

import { ThemeProvider } from 'next-themes';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createQueryClient } from '@/lib/query-client';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(createQueryClient);

  return (
    // ThemeProvider: attribute="class" → <html> üzerine .dark / .sepia sınıfı ekler
    // enableSystem: OS tercihini otomatik algılar (prefers-color-scheme)
    // themes: ['light','dark','sepia'] — Sepya modu rakiplerde yok (Harvey, CoCounsel, Lexis+)
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      themes={['light', 'dark', 'sepia']}
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
