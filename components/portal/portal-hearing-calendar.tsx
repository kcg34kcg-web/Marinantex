'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { fetchPortalWithSessionRefresh } from '@/lib/portal/client-fetch';

interface HearingItem {
  id: string;
  caseId: string;
  caseTitle: string;
  caseFileNo: string | null;
  title: string;
  description: string | null;
  scheduledAt: string;
  eventType: string;
  location: string | null;
  source: 'timeline_event';
  googleCalendarUrl: string | null;
}

interface HearingPayload {
  items: HearingItem[];
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('tr-TR');
}

export function PortalHearingCalendar() {
  const hearingsQuery = useQuery({
    queryKey: ['portal', 'hearings'],
    queryFn: async () => {
      const response = await fetchPortalWithSessionRefresh('/api/portal/hearings?limit=12', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Duruşma takvimi alınamadı.');
      }
      return (await response.json()) as HearingPayload;
    },
  });

  const upcomingItems = useMemo(() => hearingsQuery.data?.items ?? [], [hearingsQuery.data?.items]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Yaklaşan Duruşmalar</CardTitle>
      </CardHeader>
      <CardContent>
        {hearingsQuery.isLoading ? <p className="text-sm text-slate-500">Takvim yükleniyor...</p> : null}
        {hearingsQuery.isError ? <p className="text-sm text-orange-700">Duruşma takvimi alınamadı.</p> : null}

        {!hearingsQuery.isLoading && !hearingsQuery.isError ? (
          upcomingItems.length === 0 ? (
            <p className="text-sm text-slate-600">Yaklaşan duruşma kaydı bulunmuyor.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {upcomingItems.map((item) => (
                <li key={item.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">{item.title}</p>
                    <p className="text-xs text-slate-600">{formatDate(item.scheduledAt)}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-700">
                    {item.caseTitle}
                    {item.caseFileNo ? ` • Dosya No: ${item.caseFileNo}` : ''}
                  </p>
                  {item.location ? <p className="mt-1 text-xs text-slate-500">Yer: {item.location}</p> : null}
                  {item.description ? <p className="mt-1 text-xs text-slate-600">{item.description}</p> : null}
                  <div className="mt-2">
                    {item.googleCalendarUrl ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={item.googleCalendarUrl} target="_blank" rel="noreferrer">
                          Google Takvime Ekle
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
