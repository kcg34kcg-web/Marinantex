'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface PortalDemoItem {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'closed' | 'archived';
  fileNo: string | null;
  updatedAt: string;
  latestPublicUpdate: { message: string; date: string } | null;
  latestDocument: { fileName: string; createdAt: string } | null;
  latestMessage: { body: string; createdAt: string } | null;
  upcomingHearing: { title: string; scheduledAt: string } | null;
  openInPortalHref: string;
}

interface PortalDemoPayload {
  items: PortalDemoItem[];
}

function statusLabel(status: 'open' | 'in_progress' | 'closed' | 'archived') {
  if (status === 'open') return 'Açık';
  if (status === 'in_progress') return 'İlerliyor';
  if (status === 'closed') return 'Kapalı';
  return 'Arşiv';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('tr-TR');
}

export function PortalDemoPanel() {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const demoQuery = useQuery({
    queryKey: ['dashboard', 'portal-demo'],
    queryFn: async () => {
      const response = await fetch('/api/dashboard/portal-demo?autoSeed=1', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Portal demo verisi alınamadı.');
      }
      return (await response.json()) as PortalDemoPayload;
    },
  });

  async function seedAgain() {
    setStatusMessage(null);
    const response = await fetch('/api/dashboard/portal-demo', {
      method: 'POST',
    });
    if (!response.ok) {
      setStatusMessage('Demo seed işlemi başarısız.');
      return;
    }
    setStatusMessage('Demo dava seti güncellendi.');
    await demoQuery.refetch();
  }

  const items = demoQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Müvekkil Portalı Demo</CardTitle>
          <Button type="button" variant="outline" onClick={seedAgain}>
            Demo Seti Yükle/Güncelle
          </Button>
        </CardHeader>
        <CardContent className="text-sm text-slate-700">
          Bu ekran yalnızca test ve kontrol için ofis panelinde görünür. Canlıda müvekkil portalı `client` rolüne
          özeldir.
          {statusMessage ? <p className="mt-2 text-sm text-slate-600">{statusMessage}</p> : null}
        </CardContent>
      </Card>

      {demoQuery.isLoading ? <p className="text-sm text-slate-500">Demo verileri yükleniyor...</p> : null}
      {demoQuery.isError ? <p className="text-sm text-orange-700">Demo verileri alınamadı.</p> : null}

      {!demoQuery.isLoading && !demoQuery.isError ? (
        items.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-slate-600">Demo dava seti henüz oluşturulmamış.</CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <Card key={item.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    <span>{item.title}</span>
                    <Badge variant={item.status === 'in_progress' ? 'orange' : 'blue'}>{statusLabel(item.status)}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-700">
                  <p>Dosya No: {item.fileNo ?? '-'}</p>
                  <p>Son Güncelleme: {formatDate(item.updatedAt)}</p>
                  {item.upcomingHearing ? (
                    <p>
                      Yaklaşan duruşma: {item.upcomingHearing.title} ({formatDate(item.upcomingHearing.scheduledAt)})
                    </p>
                  ) : (
                    <p>Yaklaşan duruşma: -</p>
                  )}
                  {item.latestPublicUpdate ? (
                    <p>Son müvekkil güncellemesi: {item.latestPublicUpdate.message}</p>
                  ) : (
                    <p>Son müvekkil güncellemesi: -</p>
                  )}
                  {item.latestDocument ? <p>Son belge: {item.latestDocument.fileName}</p> : <p>Son belge: -</p>}
                  {item.latestMessage ? <p>Son mesaj: {item.latestMessage.body}</p> : <p>Son mesaj: -</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

