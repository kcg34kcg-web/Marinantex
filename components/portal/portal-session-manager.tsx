'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { fetchPortalWithSessionRefresh } from '@/lib/portal/client-fetch';

interface SessionItem {
  id: string;
  deviceId: string;
  deviceName: string | null;
  ipAddress: string | null;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  isCurrent: boolean;
}

interface SessionsPayload {
  currentSessionId: string | null;
  items: SessionItem[];
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('tr-TR');
}

export function PortalSessionManager() {
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const sessionsQuery = useQuery({
    queryKey: ['portal', 'sessions'],
    queryFn: async () => {
      const response = await fetchPortalWithSessionRefresh('/api/portal/sessions', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Oturumlar alınamadı.');
      }
      return (await response.json()) as SessionsPayload;
    },
  });

  const sessions = sessionsQuery.data?.items ?? [];
  const activeCount = useMemo(() => sessions.filter((item) => !item.revokedAt).length, [sessions]);

  async function refreshSession() {
    setStatusMessage(null);
    setRefreshing(true);
    try {
      const response = await fetch('/api/portal/sessions/refresh', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Oturum yenileme başarısız.');
      }
      setStatusMessage('Aktif cihaz oturumu yenilendi.');
      await sessionsQuery.refetch();
    } catch {
      setStatusMessage('Oturum yenileme başarısız. Girişinizi yenileyin.');
    } finally {
      setRefreshing(false);
    }
  }

  async function revokeSession(sessionId: string) {
    setStatusMessage(null);
    setBusySessionId(sessionId);
    try {
      const response = await fetchPortalWithSessionRefresh(`/api/portal/sessions/${sessionId}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Cihaz oturumu iptal edilemedi.');
      }
      setStatusMessage('Cihaz oturumu iptal edildi.');
      await sessionsQuery.refetch();
    } catch {
      setStatusMessage('Cihaz oturumu iptal edilemedi.');
    } finally {
      setBusySessionId(null);
    }
  }

  async function revokeOthers() {
    setStatusMessage(null);
    setBusySessionId('others');
    try {
      const response = await fetchPortalWithSessionRefresh('/api/portal/sessions', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error('Diğer cihazlar iptal edilemedi.');
      }
      setStatusMessage('Diğer cihaz oturumları kapatıldı.');
      await sessionsQuery.refetch();
    } catch {
      setStatusMessage('Diğer cihaz oturumları kapatılamadı.');
    } finally {
      setBusySessionId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Cihaz Oturumları</CardTitle>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={refreshSession} disabled={refreshing}>
            {refreshing ? 'Yenileniyor...' : 'Bu Cihazı Yenile'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={revokeOthers} disabled={busySessionId === 'others'}>
            {busySessionId === 'others' ? 'Kapatılıyor...' : 'Diğer Cihazları Kapat'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-600">Aktif cihaz sayısı: {activeCount}</p>
        {sessionsQuery.isLoading ? <p className="text-sm text-slate-500">Oturumlar yükleniyor...</p> : null}
        {sessionsQuery.isError ? <p className="text-sm text-orange-700">Oturum verisi alınamadı.</p> : null}

        {!sessionsQuery.isLoading && !sessionsQuery.isError ? (
          sessions.length === 0 ? (
            <p className="text-sm text-slate-600">Kaydedilmiş cihaz oturumu bulunmuyor.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {sessions.map((item) => (
                <li key={item.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">
                      {item.deviceName ?? 'Bilinmeyen cihaz'} {item.isCurrent ? '(Bu cihaz)' : ''}
                    </p>
                    {!item.isCurrent ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => revokeSession(item.id)}
                        disabled={busySessionId === item.id}
                      >
                        {busySessionId === item.id ? 'İptal...' : 'Cihazı Kapat'}
                      </Button>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">IP: {item.ipAddress ?? '-'}</p>
                  <p className="mt-1 text-xs text-slate-500">Son görülen: {formatDate(item.lastSeenAt)}</p>
                  <p className="mt-1 text-xs text-slate-500">Oluşturulma: {formatDate(item.createdAt)}</p>
                  <p className="mt-1 text-xs text-slate-500">Geçerlilik: {formatDate(item.expiresAt)}</p>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {statusMessage ? <p className="text-sm text-slate-700">{statusMessage}</p> : null}
      </CardContent>
    </Card>
  );
}
