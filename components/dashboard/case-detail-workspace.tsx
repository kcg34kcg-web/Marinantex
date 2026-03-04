'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs } from '@/components/ui/tabs';
import { formatDateTR } from '@/lib/date';
import { PetitionWizard } from '@/components/dashboard/petition-wizard';

interface CaseDetailWorkspaceProps {
  caseId: string;
}

type CaseDetailData = {
  case: {
    id: string;
    title: string;
    status: 'open' | 'in_progress' | 'closed' | 'archived';
    fileNo: string | null;
    caseCode: string | null;
    tags: string[];
    overviewNotes: string;
    overviewNotesUpdatedAt: string | null;
    updatedAt: string;
    createdAt: string;
    linkedClients: Array<{
      id: string;
      fullName: string;
      email: string | null;
      fileNo: string | null;
      publicRefCode: string;
      relationId: string;
      relationPublicRefCode: string;
      relationNote: string | null;
      linkedAt: string;
    }>;
  };
  aiSummary: {
    id: string;
    summaryText: string | null;
    status: 'placeholder' | 'generating' | 'ready' | 'failed';
    lastGeneratedAt: string | null;
    updatedAt: string | null;
  } | null;
};

type CaseDocument = {
  id: string;
  publicRefCode: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string | null;
  createdAt: string;
};

type TimelineEvent = {
  id: string;
  eventType: 'note' | 'document_upload' | 'message_sent' | 'status_change' | 'reminder' | 'user_action';
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function statusLabel(status: CaseDetailData['case']['status']) {
  if (status === 'open') return 'Acik';
  if (status === 'in_progress') return 'Ilerliyor';
  if (status === 'closed') return 'Kapali';
  return 'Arsiv';
}

function statusVariant(status: CaseDetailData['case']['status']) {
  if (status === 'open') return 'blue' as const;
  if (status === 'in_progress') return 'orange' as const;
  return 'muted' as const;
}

export function CaseDetailWorkspace({ caseId }: CaseDetailWorkspaceProps) {
  const [overviewDraft, setOverviewDraft] = useState('');
  const [overviewAction, setOverviewAction] = useState<string | null>(null);
  const [isSavingOverview, setIsSavingOverview] = useState(false);

  const [uploadAction, setUploadAction] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [timelineType, setTimelineType] = useState<TimelineEvent['eventType']>('note');
  const [timelineTitle, setTimelineTitle] = useState('');
  const [timelineDescription, setTimelineDescription] = useState('');
  const [editingTimelineEventId, setEditingTimelineEventId] = useState<string | null>(null);
  const [timelineAction, setTimelineAction] = useState<string | null>(null);
  const [isTimelineSubmitting, setIsTimelineSubmitting] = useState(false);

  const [summaryAction, setSummaryAction] = useState<string | null>(null);
  const [isRegeneratingSummary, setIsRegeneratingSummary] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery<CaseDetailData, Error>({
    queryKey: ['dashboard', 'case-detail', caseId],
    queryFn: async () => {
      const response = await fetch(`/api/dashboard/cases/detail?caseId=${encodeURIComponent(caseId)}`, { cache: 'no-store' });
      const payload = (await response.json()) as CaseDetailData & { error?: string };

      if (!response.ok || !payload.case) {
        throw new Error(payload.error ?? 'Dosya detayi alinamadi.');
      }

      return payload;
    },
  });

  const {
    data: documentPayload,
    isLoading: documentsLoading,
    isError: documentsError,
    error: documentsErrorMessage,
    refetch: refetchDocuments,
  } = useQuery<{ items: CaseDocument[] }, Error>({
    queryKey: ['dashboard', 'case-detail', caseId, 'documents'],
    queryFn: async () => {
      const response = await fetch(`/api/dashboard/cases/documents?caseId=${encodeURIComponent(caseId)}`, { cache: 'no-store' });
      const payload = (await response.json()) as { items?: CaseDocument[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Belge listesi alinamadi.');
      }

      return { items: payload.items ?? [] };
    },
  });

  const {
    data: timelinePayload,
    isLoading: timelineLoading,
    isError: timelineIsError,
    error: timelineError,
    refetch: refetchTimeline,
  } = useQuery<{ items: TimelineEvent[] }, Error>({
    queryKey: ['dashboard', 'case-detail', caseId, 'timeline'],
    queryFn: async () => {
      const response = await fetch(`/api/dashboard/cases/timeline?caseId=${encodeURIComponent(caseId)}`, { cache: 'no-store' });
      const payload = (await response.json()) as { items?: TimelineEvent[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Timeline alinamadi.');
      }

      return { items: payload.items ?? [] };
    },
  });

  const {
    data: summaryPayload,
    isLoading: summaryLoading,
    isError: summaryIsError,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery<
    {
      summary: {
        id: string | null;
        status: 'placeholder' | 'generating' | 'ready' | 'failed';
        summaryText: string;
        sourceSnapshot: Record<string, unknown>;
        lastGeneratedAt: string | null;
        updatedAt: string | null;
      };
    },
    Error
  >({
    queryKey: ['dashboard', 'case-detail', caseId, 'ai-summary'],
    queryFn: async () => {
      const response = await fetch(`/api/dashboard/cases/ai-summary?caseId=${encodeURIComponent(caseId)}`, { cache: 'no-store' });
      const payload = (await response.json()) as {
        summary?: {
          id: string | null;
          status: 'placeholder' | 'generating' | 'ready' | 'failed';
          summaryText: string;
          sourceSnapshot: Record<string, unknown>;
          lastGeneratedAt: string | null;
          updatedAt: string | null;
        };
        error?: string;
      };

      if (!response.ok || !payload.summary) {
        throw new Error(payload.error ?? 'AI dosya ozeti alinamadi.');
      }

      return { summary: payload.summary };
    },
  });

  const documents = documentPayload?.items ?? [];
  const timelineItems = timelinePayload?.items ?? [];

  useEffect(() => {
    if (data?.case) {
      setOverviewDraft(data.case.overviewNotes ?? '');
    }
  }, [data?.case?.id, data?.case?.overviewNotes]);

  const overviewText = overviewDraft;

  async function saveOverview() {
    if (!data?.case) {
      return;
    }

    setIsSavingOverview(true);
    setOverviewAction(null);

    try {
      const response = await fetch('/api/dashboard/cases/overview', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId,
          overviewNotes: overviewText,
        }),
      });

      const payload = (await response.json()) as { error?: string; updatedAt?: string };
      if (!response.ok) {
        setOverviewAction(payload.error ?? 'Genel bakis notu kaydedilemedi.');
        return;
      }

      setOverviewAction('Genel bakis notu kaydedildi.');
      await refetch();
    } catch {
      setOverviewAction('Genel bakis notu kaydedilirken ag hatasi olustu.');
    } finally {
      setIsSavingOverview(false);
    }
  }

  async function uploadDocument(file: File) {
    setIsUploading(true);
    setUploadAction(null);

    try {
      const formData = new FormData();
      formData.append('caseId', caseId);
      formData.append('file', file);

      const response = await fetch('/api/dashboard/cases/documents', {
        method: 'POST',
        body: formData,
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setUploadAction(payload.error ?? 'Belge yukleme basarisiz oldu.');
        return;
      }

      setUploadAction('Belge yuklendi.');
      await Promise.all([refetchDocuments(), refetchTimeline()]);
    } catch {
      setUploadAction('Belge yukleme sirasinda ag hatasi olustu.');
    } finally {
      setIsUploading(false);
    }
  }

  async function deleteDocument(documentId: string) {
    setUploadAction(null);

    try {
      const response = await fetch('/api/dashboard/cases/documents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId,
          documentId,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setUploadAction(payload.error ?? 'Belge silinemedi.');
        return;
      }

      setUploadAction('Belge silindi.');
      await Promise.all([refetchDocuments(), refetchTimeline()]);
    } catch {
      setUploadAction('Belge silme sirasinda ag hatasi olustu.');
    }
  }

  async function addTimelineEvent() {
    if (!timelineTitle.trim()) {
      setTimelineAction('Event basligi zorunlu.');
      return;
    }

    setIsTimelineSubmitting(true);
    setTimelineAction(null);

    try {
      const response = await fetch('/api/dashboard/cases/timeline', {
        method: editingTimelineEventId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editingTimelineEventId
            ? {
                caseId,
                eventId: editingTimelineEventId,
                title: timelineTitle.trim(),
                description: timelineDescription.trim() || undefined,
              }
            : {
                caseId,
                eventType: timelineType,
                title: timelineTitle.trim(),
                description: timelineDescription.trim() || undefined,
              },
        ),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setTimelineAction(payload.error ?? 'Timeline event eklenemedi.');
        return;
      }

      setTimelineAction(editingTimelineEventId ? 'Timeline event guncellendi.' : 'Timeline event eklendi.');
      setTimelineTitle('');
      setTimelineDescription('');
      setEditingTimelineEventId(null);
      await refetchTimeline();
    } catch {
      setTimelineAction('Timeline event eklenirken ag hatasi olustu.');
    } finally {
      setIsTimelineSubmitting(false);
    }
  }

  async function deleteTimelineEvent(eventId: string) {
    setTimelineAction(null);
    try {
      const response = await fetch('/api/dashboard/cases/timeline', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId,
          eventId,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setTimelineAction(payload.error ?? 'Timeline event silinemedi.');
        return;
      }
      setTimelineAction('Timeline event silindi.');
      await refetchTimeline();
    } catch {
      setTimelineAction('Timeline event silinirken ag hatasi olustu.');
    }
  }

  async function regenerateSummary() {
    setIsRegeneratingSummary(true);
    setSummaryAction(null);

    try {
      const response = await fetch('/api/dashboard/cases/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSummaryAction(payload.error ?? 'AI ozet olusturulamadi.');
        return;
      }

      setSummaryAction('AI dosya ozeti guncellendi.');
      await Promise.all([refetchSummary(), refetchTimeline()]);
    } catch {
      setSummaryAction('AI ozet olusturulurken ag hatasi olustu.');
    } finally {
      setIsRegeneratingSummary(false);
    }
  }

  const tabItems = [
    {
      value: 'overview',
      label: 'Genel Bakis',
      content: (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Genel Bakis Notu</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={overviewText}
                onChange={(event) => setOverviewDraft(event.target.value)}
                placeholder="Bu dosya icin serbest notlarinizi yazin..."
                className="min-h-[220px]"
              />
              {overviewAction ? <p className="text-xs text-slate-600">{overviewAction}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOverviewDraft(data?.case.overviewNotes ?? '')}>
                  Sifirla
                </Button>
                <Button type="button" disabled={isSavingOverview} onClick={saveOverview}>
                  {isSavingOverview ? 'Kaydediliyor...' : 'Kaydet'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bagli Muvekkiller</CardTitle>
            </CardHeader>
            <CardContent>
              {data?.case.linkedClients.length ? (
                <div className="flex flex-wrap gap-2">
                  {data.case.linkedClients.map((client) => (
                    <Link
                      key={client.id}
                      href={`/dashboard/clients/${client.id}` as Route}
                      className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:underline"
                    >
                      {client.fullName}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Bu dosyaya bagli muvekkil bulunamadi.</p>
              )}
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      value: 'documents',
      label: 'Belgeler',
      content: (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Belge Yukleme</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                type="file"
                accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    return;
                  }
                  uploadDocument(file).catch(() => {
                    setUploadAction('Belge yukleme sirasinda beklenmeyen hata olustu.');
                  });
                  event.currentTarget.value = '';
                }}
                disabled={isUploading}
                className="block w-full text-sm"
              />
              <p className="text-xs text-slate-500">Desteklenen formatlar: PDF, DOCX, XLSX, JPG, PNG.</p>
              {uploadAction ? <p className="text-xs text-slate-600">{uploadAction}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Yuklenen Belgeler</CardTitle>
                <Button type="button" size="sm" variant="outline" onClick={() => refetchDocuments()}>
                  Yenile
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {documentsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : documentsError ? (
                <p className="text-sm text-orange-600">{documentsErrorMessage instanceof Error ? documentsErrorMessage.message : 'Belge listesi alinamadi.'}</p>
              ) : documents.length === 0 ? (
                <p className="text-sm text-slate-500">Henuz belge yuklenmedi.</p>
              ) : (
                <ul className="space-y-2">
                  {documents.map((item) => (
                    <li key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{item.fileName}</p>
                          <p className="text-xs text-slate-600">{item.publicRefCode} · {item.mimeType}</p>
                          <p className="text-xs text-slate-500" suppressHydrationWarning>{formatDateTR(item.createdAt)}</p>
                        </div>
                        <div className="flex gap-2">
                          <a
                            href={`/api/dashboard/cases/documents/download?caseId=${encodeURIComponent(caseId)}&documentId=${encodeURIComponent(item.id)}`}
                            className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-muted"
                          >
                            Indir
                          </a>
                          <Button type="button" size="sm" variant="outline" onClick={() => deleteDocument(item.id)}>
                            Sil
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      value: 'timeline',
      label: 'Zaman Cizelgesi',
      content: (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Yeni Event Ekle</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-3">
                <select
                  value={timelineType}
                  onChange={(event) => setTimelineType(event.target.value as TimelineEvent['eventType'])}
                  className="h-10 rounded-md border border-input bg-white px-3 text-sm"
                >
                  <option value="note">Not</option>
                  <option value="document_upload">Belge Yukleme</option>
                  <option value="message_sent">Mesaj Gonderimi</option>
                  <option value="status_change">Durum Degisikligi</option>
                  <option value="reminder">Tarih/Hatirlatma</option>
                  <option value="user_action">Kullanici Islemi</option>
                </select>
                <Input
                  value={timelineTitle}
                  onChange={(event) => setTimelineTitle(event.target.value)}
                  placeholder="Event basligi"
                />
                <Button type="button" disabled={isTimelineSubmitting} onClick={addTimelineEvent}>
                  {isTimelineSubmitting ? 'Kaydediliyor...' : editingTimelineEventId ? 'Guncelle' : 'Event Ekle'}
                </Button>
              </div>
              <Textarea
                value={timelineDescription}
                onChange={(event) => setTimelineDescription(event.target.value)}
                placeholder="Aciklama (opsiyonel)"
              />
              {editingTimelineEventId ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingTimelineEventId(null);
                      setTimelineTitle('');
                      setTimelineDescription('');
                    }}
                  >
                    Duzenlemeyi Iptal Et
                  </Button>
                </div>
              ) : null}
              {timelineAction ? <p className="text-xs text-slate-600">{timelineAction}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Timeline</CardTitle>
                <Button type="button" size="sm" variant="outline" onClick={() => refetchTimeline()}>
                  Yenile
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {timelineLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : timelineIsError ? (
                <p className="text-sm text-orange-600">{timelineError instanceof Error ? timelineError.message : 'Timeline alinamadi.'}</p>
              ) : timelineItems.length === 0 ? (
                <p className="text-sm text-slate-500">Timeline bos.</p>
              ) : (
                <ul className="space-y-2">
                  {timelineItems.map((item) => (
                    <li key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="blue">{item.eventType}</Badge>
                        <span className="text-xs text-slate-500" suppressHydrationWarning>{formatDateTR(item.createdAt)}</span>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingTimelineEventId(item.id);
                              setTimelineType(item.eventType);
                              setTimelineTitle(item.title);
                              setTimelineDescription(item.description ?? '');
                              setTimelineAction(null);
                            }}
                          >
                            Duzenle
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => deleteTimelineEvent(item.id)}>
                            Sil
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm font-medium text-slate-900">{item.title}</p>
                      {item.description ? <p className="text-sm text-slate-700">{item.description}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      value: 'ai-summary',
      label: 'AI Dosya Ozeti',
      content: (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>AI Dosya Ozeti</CardTitle>
              <Button type="button" disabled={isRegeneratingSummary} onClick={regenerateSummary}>
                {isRegeneratingSummary ? 'Uretiliyor...' : 'Ozeti Yeniden Olustur'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {summaryAction ? <p className="text-xs text-slate-600">{summaryAction}</p> : null}
            {summaryLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : summaryIsError ? (
              <p className="text-sm text-orange-600">{summaryError instanceof Error ? summaryError.message : 'AI ozet alinamadi.'}</p>
            ) : (
              <>
                <p className="whitespace-pre-wrap text-sm text-slate-800">{summaryPayload?.summary.summaryText}</p>
                <p className="text-xs text-slate-500" suppressHydrationWarning>
                  Son guncellenme: {summaryPayload?.summary.updatedAt ? formatDateTR(summaryPayload.summary.updatedAt) : '-'}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ),
    },
    {
      value: 'petition',
      label: 'Dilekce Sihirbazi',
      content: <PetitionWizard caseId={caseId} />,
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data?.case) {
    return <p className="text-sm text-orange-600">{error instanceof Error ? error.message : 'Dosya detayi alinamadi.'}</p>;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{data.case.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <Badge variant={statusVariant(data.case.status)}>{statusLabel(data.case.status)}</Badge>
            <span>CaseCode: {data.case.caseCode ?? '-'}</span>
            <span>DosyaNo: {data.case.fileNo ?? '-'}</span>
            <span suppressHydrationWarning>Son Guncelleme: {formatDateTR(data.case.updatedAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/cases/${caseId}/finance` as Route} className="text-sm font-medium text-blue-600 hover:underline">
            Finans Sayfasi
          </Link>
          <Link href={`/cases/${caseId}/intelligence` as Route} className="text-sm font-medium text-blue-600 hover:underline">
            Intelligence
          </Link>
          <Button type="button" size="sm" variant="outline" onClick={() => refetch()}>
            Yenile
          </Button>
        </div>
      </div>
      <Tabs items={tabItems} />
    </section>
  );
}

