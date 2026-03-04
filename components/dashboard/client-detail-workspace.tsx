'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { formatDateTR } from '@/lib/date';

type ClientDetail = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  tcIdentity: string | null;
  partyType: 'plaintiff' | 'defendant' | 'consultant' | null;
  fileNo: string | null;
  publicRefCode: string | null;
  status: 'active' | 'invited' | 'inactive';
  createdAt: string;
  updatedAt: string;
};

type LinkedCase = {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'closed' | 'archived';
  fileNo: string | null;
  updatedAt: string;
};

type ClientMessage = {
  id: string;
  publicRefCode: string;
  body: string;
  caseId: string | null;
  status: 'pending' | 'sent' | 'failed';
  createdAt: string;
  deliveries: Array<{
    id: string;
    channel: 'in_app' | 'email' | 'whatsapp';
    status: 'pending' | 'sent' | 'failed';
    errorMessage: string | null;
  }>;
};

function partyTypeLabel(value: ClientDetail['partyType']) {
  if (value === 'plaintiff') return 'Davaci';
  if (value === 'defendant') return 'Davali';
  if (value === 'consultant') return 'Danisan';
  return '-';
}

export function ClientDetailWorkspace({ clientId }: { clientId: string }) {
  const [messageBody, setMessageBody] = useState('');
  const [messageCaseId, setMessageCaseId] = useState('');
  const [sendEmailAlso, setSendEmailAlso] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery<
    { client: ClientDetail; linkedCases: LinkedCase[] },
    Error
  >({
    queryKey: ['dashboard', 'client-detail', clientId],
    queryFn: async () => {
      const response = await fetch(`/api/dashboard/clients/${clientId}`, { cache: 'no-store' });
      const payload = (await response.json()) as {
        client?: ClientDetail;
        linkedCases?: LinkedCase[];
        error?: string;
      };

      if (!response.ok || !payload.client) {
        throw new Error(payload.error ?? 'Muvekkil detayi alinamadi.');
      }

      return {
        client: payload.client,
        linkedCases: payload.linkedCases ?? [],
      };
    },
  });

  const {
    data: messagePayload,
    isLoading: messageLoading,
    isError: messageIsError,
    error: messageError,
    refetch: refetchMessages,
  } = useQuery<{ messages: ClientMessage[] }, Error>({
    queryKey: ['dashboard', 'client-detail', clientId, 'messages'],
    queryFn: async () => {
      const response = await fetch(`/api/dashboard/clients/${clientId}/messages`, { cache: 'no-store' });
      const payload = (await response.json()) as { messages?: ClientMessage[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Mesaj gecmisi alinamadi.');
      }

      return {
        messages: payload.messages ?? [],
      };
    },
  });

  const messages = useMemo(() => messagePayload?.messages ?? [], [messagePayload]);

  async function sendMessage() {
    if (!messageBody.trim()) {
      setActionMessage('Mesaj metni bos olamaz.');
      return;
    }

    setIsSending(true);
    setActionMessage(null);

    try {
      const response = await fetch(`/api/dashboard/clients/${clientId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: messageBody.trim(),
          caseId: messageCaseId.trim() || undefined,
          sendEmailAlso,
        }),
      });

      const payload = (await response.json()) as {
        message?: { status?: 'pending' | 'sent' | 'failed'; emailError?: string | null };
        error?: string;
      };

      if (!response.ok) {
        setActionMessage(payload.error ?? 'Mesaj gonderilemedi.');
        return;
      }

      const status = payload.message?.status ?? 'pending';
      setActionMessage(
        status === 'failed'
          ? `Mesaj kaydi olustu ancak teslim basarisiz: ${payload.message?.emailError ?? '-'}`
          : status === 'sent'
            ? 'Mesaj gonderildi.'
            : 'Mesaj beklemede.',
      );

      setMessageBody('');
      setMessageCaseId('');
      await refetchMessages();
    } catch {
      setActionMessage('Mesaj gonderimi sirasinda ag hatasi olustu.');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Muvekkil Detay</h1>
        <Link href={'/dashboard/clients' as Route} className="text-sm font-medium text-blue-700 hover:underline">
          Listeye Don
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-orange-600">{error instanceof Error ? error.message : 'Muvekkil detayi alinamadi.'}</p>
      ) : data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{data.client.fullName}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3 text-sm">
              <div>
                <p className="text-xs text-slate-500">E-Posta</p>
                <p className="font-medium text-slate-800">{data.client.email ?? '-'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Telefon</p>
                <p className="font-medium text-slate-800">{data.client.phone ?? '-'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Taraf Tipi</p>
                <p className="font-medium text-slate-800">{partyTypeLabel(data.client.partyType)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Dosya No</p>
                <p className="font-medium text-slate-800">{data.client.fileNo ?? '-'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Public Ref</p>
                <p className="font-medium text-slate-800">{data.client.publicRefCode ?? '-'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Durum</p>
                <Badge variant={data.client.status === 'active' ? 'blue' : data.client.status === 'invited' ? 'orange' : 'muted'}>
                  {data.client.status}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Bagli Dosyalar</CardTitle>
                  <Button type="button" size="sm" variant="outline" onClick={() => refetch()}>
                    Yenile
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {data.linkedCases.length === 0 ? (
                  <p className="text-sm text-slate-500">Bagli dosya bulunamadi.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.linkedCases.map((item) => (
                      <li key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{item.title}</p>
                            <p className="text-xs text-slate-600">Dosya No: {item.fileNo ?? '-'}</p>
                            <p className="text-xs text-slate-500" suppressHydrationWarning>
                              Son guncelleme: {formatDateTR(item.updatedAt)}
                            </p>
                          </div>
                          <Link
                            href={`/dashboard/cases/${item.id}` as Route}
                            className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-muted"
                          >
                            Dosyaya Git
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Mesaj Gonder</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Case ID (opsiyonel)</label>
                  <Input value={messageCaseId} onChange={(event) => setMessageCaseId(event.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Mesaj</label>
                  <textarea
                    value={messageBody}
                    onChange={(event) => setMessageBody(event.target.value)}
                    className="min-h-[130px] w-full rounded-md border border-input px-3 py-2 text-sm"
                    placeholder="Muvekkile iletilecek mesaji yazin..."
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={sendEmailAlso} onChange={(event) => setSendEmailAlso(event.target.checked)} />
                  E-posta olarak da gonder
                </label>
                {actionMessage ? <p className="text-xs text-slate-600">{actionMessage}</p> : null}
                <div className="flex justify-end">
                  <Button type="button" disabled={isSending || !messageBody.trim()} onClick={sendMessage}>
                    {isSending ? 'Gonderiliyor...' : 'Mesaj Gonder'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Mesaj Gecmisi</CardTitle>
                <Button type="button" size="sm" variant="outline" onClick={() => refetchMessages()}>
                  Yenile
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {messageLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : messageIsError ? (
                <p className="text-sm text-orange-600">{messageError instanceof Error ? messageError.message : 'Mesaj gecmisi alinamadi.'}</p>
              ) : messages.length === 0 ? (
                <p className="text-sm text-slate-500">Henuz mesaj yok.</p>
              ) : (
                <ul className="space-y-3">
                  {messages.map((message) => (
                    <li key={message.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge variant={message.status === 'sent' ? 'blue' : message.status === 'failed' ? 'orange' : 'muted'}>
                          {message.status === 'sent' ? 'gonderildi' : message.status === 'failed' ? 'basarisiz' : 'beklemede'}
                        </Badge>
                        <span className="text-xs text-slate-500">{message.publicRefCode}</span>
                        <span className="text-xs text-slate-500" suppressHydrationWarning>
                          {formatDateTR(message.createdAt)}
                        </span>
                        {message.caseId ? (
                          <Link href={`/dashboard/cases/${message.caseId}` as Route} className="text-xs font-medium text-blue-700 hover:underline">
                            dosyaya git
                          </Link>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-slate-800">{message.body}</p>
                      <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-slate-600">
                        {message.deliveries.map((delivery) => (
                          <span key={delivery.id} className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                            {delivery.channel}: {delivery.status}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}


