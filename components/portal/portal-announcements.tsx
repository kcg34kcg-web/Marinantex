'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchPortalAnnouncements } from '@/lib/queries';

export function PortalAnnouncements() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['portal', 'announcements'],
    queryFn: fetchPortalAnnouncements,
    retry: 0,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bilgilendirme</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  // If the table isn't created yet or RLS blocks, we avoid blocking portal.
  if (isError || !data || data.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bilgilendirme</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-700">
        {data.map((item) => (
          <div key={item.id} className="rounded-md border border-border bg-slate-50 p-3">
            <p className="font-medium text-slate-900">{item.title}</p>
            <p className="mt-1 text-sm text-slate-700">{item.body}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
