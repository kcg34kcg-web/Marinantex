'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { OfficeNotification } from '@/lib/office/notifications';

export function OfficeNotificationFeed() {
  const [events, setEvents] = useState<OfficeNotification[]>([]);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [activeTab, setActiveTab] = useState<'all' | 'hearings' | 'messages' | 'tasks' | 'documents'>('all');
  const [readIds, setReadIds] = useState<Record<string, true>>({});

  useEffect(() => {
    const source = new EventSource('/api/office/notifications/stream');

    source.addEventListener('open', () => {
      setStatus('connected');
    });

    source.addEventListener('notification', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as OfficeNotification;
      setEvents((previous) => [payload, ...previous].slice(0, 30));
    });

    source.addEventListener('error', () => {
      setStatus('disconnected');
    });

    return () => {
      source.close();
    };
  }, []);

  const statusLabel = useMemo(() => {
    if (status === 'connected') return 'Bağlı';
    if (status === 'disconnected') return 'Bağlantı kesildi';
    return 'Bağlanıyor';
  }, [status]);

  const filteredEvents = useMemo(() => {
    if (activeTab === 'all') {
      return events;
    }

    return events.filter((item) => item.category === activeTab);
  }, [activeTab, events]);

  const unreadCount = useMemo(() => {
    return events.filter((item) => !readIds[item.id]).length;
  }, [events, readIds]);

  const tabs: Array<{ id: 'all' | 'hearings' | 'messages' | 'tasks' | 'documents'; label: string }> = [
    { id: 'all', label: 'Tümü' },
    { id: 'hearings', label: 'Duruşmalar' },
    { id: 'messages', label: 'Mesajlar' },
    { id: 'tasks', label: 'Görevler' },
    { id: 'documents', label: 'Belgeler' },
  ];

  const markRead = (id: string) => {
    setReadIds((previous) => ({ ...previous, [id]: true }));
  };

  const markAllAsRead = () => {
    const next: Record<string, true> = {};
    events.forEach((item) => {
      next[item.id] = true;
    });
    setReadIds(next);
  };

  const categoryLabel: Record<OfficeNotification['category'], string> = {
    hearings: 'Duruşma',
    messages: 'Mesaj',
    tasks: 'Görev',
    documents: 'Belge',
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Operasyon Akışı</CardTitle>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
            <span className={status === 'connected' ? 'h-2 w-2 rounded-full bg-emerald-500' : 'h-2 w-2 rounded-full bg-orange-500'} />
            {statusLabel}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>Okunmamış bildirim: {unreadCount}</span>
          <button
            type="button"
            onClick={markAllAsRead}
            disabled={events.length === 0}
            className="rounded-md border border-border bg-white px-2 py-1 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Tümünü okundu yap
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={
                activeTab === tab.id
                  ? 'rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-md border border-border bg-white px-3 py-1 text-xs font-medium text-slate-700'
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {filteredEvents.length === 0 ? (
          <p className="text-sm text-slate-600">Henüz bildirim bulunmuyor. Yeni olaylar burada görünecek.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {filteredEvents.map((item) => (
              <li
                key={item.id}
                className={
                  readIds[item.id]
                    ? 'rounded-xl border border-border bg-white p-3 shadow-sm'
                    : 'rounded-xl border border-blue-200 bg-blue-50 p-3 shadow-sm'
                }
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-800">{item.title}</p>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {categoryLabel[item.category]}
                  </span>
                </div>
                <p className="text-xs text-slate-600">{item.detail}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-400">{new Date(item.createdAt).toLocaleString('tr-TR')}</p>
                  <div className="flex items-center gap-2">
                    {item.actionUrl ? (
                      <Link
                        href={item.actionUrl as Route}
                        onClick={() => markRead(item.id)}
                        className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
                      >
                        {item.actionLabel ?? 'Aç'}
                      </Link>
                    ) : null}
                    {!readIds[item.id] ? (
                      <button
                        type="button"
                        onClick={() => markRead(item.id)}
                        className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
                      >
                        Okundu
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
