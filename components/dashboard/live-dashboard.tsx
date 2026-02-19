'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchDashboardData } from '@/lib/queries';
import { formatDateTR } from '@/lib/date';

export function LiveDashboard() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: fetchDashboardData,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Günaydın Özeti</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </>
          ) : isError ? (
            <p className="text-sm text-orange-600">{error instanceof Error ? error.message : 'Veri alınamadı.'}</p>
          ) : (
            <p className="text-sm text-slate-700">{data?.briefingText}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Yaklaşan Son Tarihler</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : isError ? (
            <p className="text-sm text-orange-600">Takvim verileri yüklenemedi.</p>
          ) : data && data.deadlines.length > 0 ? (
            <ul className="space-y-3">
              {data.deadlines.map((item) => (
                <li key={item.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                  <span className="text-slate-800">{item.title}</span>
                  <span className="font-medium text-orange-600" suppressHydrationWarning>
                    {formatDateTR(item.date)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">Yaklaşan son tarih görünmüyor.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
