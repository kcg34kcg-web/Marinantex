'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchPortalCases } from '@/lib/queries';
import { formatDateTR } from '@/lib/date';

function getStatusLabel(status: 'open' | 'in_progress' | 'closed' | 'archived'): string {
  if (status === 'open') return 'Açık';
  if (status === 'in_progress') return 'İlerliyor';
  if (status === 'closed') return 'Kapalı';
  return 'Arşiv';
}

export function PortalCasesList() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['portal', 'cases'],
    queryFn: fetchPortalCases,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Paylaşılan Dosyalarım</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-orange-600">{error instanceof Error ? error.message : 'Dosyalar alınamadı.'}</p>
        ) : data && data.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {data.map((item) => (
              <li key={item.id} className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Link href={`/portal/cases/${item.id}` as Route} className="font-medium text-blue-600 hover:underline">
                    {item.title}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500" suppressHydrationWarning>
                    Son güncelleme: {formatDateTR(item.updatedAt)}
                  </p>
                </div>
                <Badge variant={item.status === 'in_progress' ? 'orange' : 'blue'}>{getStatusLabel(item.status)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">Henüz size paylaşılmış dosya bulunmuyor.</p>
        )}
      </CardContent>
    </Card>
  );
}
