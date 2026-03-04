'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createQueryClient } from '@/lib/query-client';
import { ThemeSettingsProvider } from '@/components/theme/theme-settings-provider';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(createQueryClient);

  return (
    <ThemeSettingsProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeSettingsProvider>
  );
}