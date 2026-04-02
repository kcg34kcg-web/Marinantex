'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { fetchPortalWithSessionRefresh } from '@/lib/portal/client-fetch';

interface PortalNotificationItem {
  id: string;
  type: 'hearing_upcoming' | 'case_updated' | 'message_received' | 'document_uploaded' | 'system_notice';
  category: 'hearings' | 'messages' | 'documents' | 'cases' | 'system';
  title: string;
  detail: string;
  actionUrl?: string;
  actionLabel?: string;
  createdAt: string;
  isRead: boolean;
}

interface PortalNotificationPayload {
  items: PortalNotificationItem[];
}

const WEB_SOCKET_URL = process.env.NEXT_PUBLIC_PORTAL_WS_URL?.trim() || '';

export function PortalNotificationStream() {
  const [events, setEvents] = useState<PortalNotificationItem[]>([]);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [transport, setTransport] = useState<'websocket' | 'sse' | 'none'>('none');
  const [readState, setReadState] = useState<Record<string, true>>({});

  useEffect(() => {
    let closed = false;
    let source: EventSource | null = null;
    let socket: WebSocket | null = null;

    async function loadInitial() {
      const response = await fetchPortalWithSessionRefresh('/api/portal/notifications?limit=20', {
        cache: 'no-store',
      });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as PortalNotificationPayload;
      setEvents(payload.items ?? []);
      const nextReadState: Record<string, true> = {};
      (payload.items ?? []).forEach((item) => {
        if (item.isRead) {
          nextReadState[item.id] = true;
        }
      });
      setReadState(nextReadState);
    }

    function applyIncoming(item: PortalNotificationItem) {
      setEvents((previous) => {
        const map = new Map(previous.map((entry) => [entry.id, entry]));
        map.set(item.id, item);
        return [...map.values()]
          .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
          .slice(0, 30);
      });
    }

    function connectSse() {
      if (closed) return;
      setTransport('sse');
      setStatus('connecting');
      source = new EventSource('/api/portal/notifications/stream');

      source.addEventListener('open', () => {
        setStatus('connected');
      });

      source.addEventListener('notification', (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as PortalNotificationItem;
        applyIncoming(payload);
      });

      source.addEventListener('error', () => {
        setStatus('disconnected');
      });
    }

    function connectWebSocket() {
      if (closed) return;
      if (!WEB_SOCKET_URL) {
        connectSse();
        return;
      }

      try {
        setTransport('websocket');
        setStatus('connecting');
        socket = new WebSocket(WEB_SOCKET_URL);

        socket.addEventListener('open', () => {
          setStatus('connected');
        });

        socket.addEventListener('message', (message) => {
          try {
            const parsed = JSON.parse(message.data as string) as
              | { type?: string; data?: PortalNotificationItem }
              | PortalNotificationItem;
            const payload =
              'data' in parsed && parsed.data ? parsed.data : (parsed as PortalNotificationItem);
            if (!payload?.id) {
              return;
            }
            applyIncoming(payload);
          } catch {
            // Ignore malformed push payloads.
          }
        });

        socket.addEventListener('error', () => {
          setStatus('disconnected');
        });

        socket.addEventListener('close', () => {
          if (closed) return;
          connectSse();
        });
      } catch {
        connectSse();
      }
    }

    void loadInitial();
    connectWebSocket();

    return () => {
      closed = true;
      source?.close();
      socket?.close();
    };
  }, []);

  const unreadCount = useMemo(() => {
    return events.filter((item) => !readState[item.id]).length;
  }, [events, readState]);

  async function markAllRead() {
    const unreadIds = events.filter((item) => !readState[item.id]).map((item) => item.id);
    if (unreadIds.length === 0) return;

    setReadState((previous) => {
      const next = { ...previous };
      unreadIds.forEach((id) => {
        next[id] = true;
      });
      return next;
    });

    await fetchPortalWithSessionRefresh('/api/portal/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: unreadIds }),
    }).catch(() => undefined);
  }

  function markRead(id: string) {
    setReadState((previous) => ({ ...previous, [id]: true }));
    void fetchPortalWithSessionRefresh('/api/portal/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [id] }),
    }).catch(() => undefined);
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Portal Bildirim Akışı</CardTitle>
          <span className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-600">
            {status === 'connected' ? 'Bağlı' : status === 'connecting' ? 'Bağlanıyor' : 'Bağlantı kesildi'} •{' '}
            {transport === 'websocket' ? 'WebSocket' : transport === 'sse' ? 'SSE (fallback)' : 'Pasif'}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>Okunmamış: {unreadCount}</span>
          <Button type="button" variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
            Tümünü okundu yap
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-slate-600">Henüz portal bildirimi yok.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {events.map((item) => (
              <li
                key={item.id}
                className={
                  readState[item.id]
                    ? 'rounded-md border border-border p-3'
                    : 'rounded-md border border-blue-200 bg-blue-50 p-3'
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-slate-900">{item.title}</p>
                  <span className="text-[11px] text-slate-500">{new Date(item.createdAt).toLocaleString('tr-TR')}</span>
                </div>
                {item.detail ? <p className="mt-1 text-xs text-slate-700">{item.detail}</p> : null}
                <div className="mt-2 flex items-center gap-2">
                  {item.actionUrl ? (
                    <Link
                      href={item.actionUrl as Route}
                      className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
                      onClick={() => markRead(item.id)}
                    >
                      {item.actionLabel ?? 'Aç'}
                    </Link>
                  ) : null}
                  {!readState[item.id] ? (
                    <button
                      type="button"
                      onClick={() => markRead(item.id)}
                      className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
                    >
                      Okundu
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
