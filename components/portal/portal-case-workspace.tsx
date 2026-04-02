'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { formatDateTR } from '@/lib/date';
import { fetchPortalWithSessionRefresh } from '@/lib/portal/client-fetch';

interface PortalCaseWorkspaceProps {
  caseId: string;
}

interface PortalCaseDetailPayload {
  case: {
    id: string;
    title: string;
    status: 'open' | 'in_progress' | 'closed' | 'archived';
    fileNo: string | null;
    updatedAt: string;
  };
}

interface PortalTimelinePayload {
  items: Array<{
    id: string;
    source: 'timeline_event' | 'case_update';
    eventType: string;
    title: string;
    description: string | null;
    createdAt: string;
  }>;
}

interface PortalDocumentsPayload {
  items: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    createdAt: string;
    signedUrlPath: string;
    versionCount: number;
  }>;
}

interface PortalMessagesPayload {
  items: Array<{
    id: string;
    body: string;
    createdAt: string;
    isOwnMessage: boolean;
  }>;
}

function getStatusLabel(status: 'open' | 'in_progress' | 'closed' | 'archived') {
  if (status === 'open') return 'Açık';
  if (status === 'in_progress') return 'İlerliyor';
  if (status === 'closed') return 'Kapalı';
  return 'Arşiv';
}

function bytesToHumanSize(input: number) {
  if (!Number.isFinite(input) || input <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = input;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function PortalCaseWorkspace({ caseId }: PortalCaseWorkspaceProps) {
  const [downloadState, setDownloadState] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['portal', 'case', caseId, 'detail'],
    queryFn: async () => {
      const response = await fetchPortalWithSessionRefresh(`/api/portal/cases/${caseId}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Dosya detayı alınamadı.');
      }
      return (await response.json()) as PortalCaseDetailPayload;
    },
  });

  const timelineQuery = useQuery({
    queryKey: ['portal', 'case', caseId, 'timeline'],
    queryFn: async () => {
      const response = await fetchPortalWithSessionRefresh(`/api/portal/cases/${caseId}/timeline?limit=10`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Timeline alınamadı.');
      }
      return (await response.json()) as PortalTimelinePayload;
    },
  });

  const documentsQuery = useQuery({
    queryKey: ['portal', 'case', caseId, 'documents'],
    queryFn: async () => {
      const response = await fetchPortalWithSessionRefresh(`/api/portal/cases/${caseId}/documents?limit=10`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Belge listesi alınamadı.');
      }
      return (await response.json()) as PortalDocumentsPayload;
    },
  });

  const messagesQuery = useQuery({
    queryKey: ['portal', 'case', caseId, 'messages'],
    queryFn: async () => {
      const response = await fetchPortalWithSessionRefresh(`/api/portal/cases/${caseId}/messages?limit=8`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Mesaj geçmişi alınamadı.');
      }
      return (await response.json()) as PortalMessagesPayload;
    },
  });

  const hasAnyLoading =
    detailQuery.isLoading || timelineQuery.isLoading || documentsQuery.isLoading || messagesQuery.isLoading;

  const caseDetail = detailQuery.data?.case ?? null;
  const timelineItems = timelineQuery.data?.items ?? [];
  const documents = documentsQuery.data?.items ?? [];
  const messages = messagesQuery.data?.items ?? [];

  const overviewError = useMemo(() => {
    return detailQuery.error || timelineQuery.error || documentsQuery.error || messagesQuery.error;
  }, [detailQuery.error, documentsQuery.error, messagesQuery.error, timelineQuery.error]);

  async function handleDownload(signedUrlPath: string, documentId: string) {
    setDownloadState(documentId);
    try {
      const signedResult = await fetchPortalWithSessionRefresh(signedUrlPath, { cache: 'no-store' });
      if (!signedResult.ok) {
        throw new Error('İndirme bağlantısı alınamadı.');
      }
      const payload = (await signedResult.json()) as { url: string };
      if (!payload.url) {
        throw new Error('İndirme bağlantısı alınamadı.');
      }
      window.location.href = payload.url;
    } catch {
      // Silent fail; page stays usable.
    } finally {
      setDownloadState(null);
    }
  }

  if (hasAnyLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (overviewError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dosya Detayı</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-orange-700">Dosya verileri alınırken bir hata oluştu.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>{caseDetail?.title ?? 'Dosya Detayı'}</span>
            {caseDetail ? <Badge variant={caseDetail.status === 'in_progress' ? 'orange' : 'blue'}>{getStatusLabel(caseDetail.status)}</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-slate-700">
          <p>Dosya Kimliği: {caseDetail?.id ?? caseId}</p>
          <p>Dosya Numarası: {caseDetail?.fileNo ?? '-'}</p>
          {caseDetail?.updatedAt ? <p suppressHydrationWarning>Son Güncelleme: {formatDateTR(caseDetail.updatedAt)}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {timelineItems.length === 0 ? (
            <p className="text-sm text-slate-600">Müvekkile açık timeline kaydı bulunmuyor.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {timelineItems.map((item) => (
                <li key={item.id} className="rounded-md border border-border p-3">
                  <p className="font-medium text-slate-900">{item.title}</p>
                  {item.description ? <p className="mt-1 text-slate-700">{item.description}</p> : null}
                  <p className="mt-1 text-xs text-slate-500" suppressHydrationWarning>
                    {formatDateTR(item.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Belgeler</CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-sm text-slate-600">Bu dosyada görüntülenebilir belge bulunmuyor.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {documents.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                  <div>
                    <p className="font-medium text-slate-900">{item.fileName}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.mimeType} • {bytesToHumanSize(item.fileSize)} • v{Math.max(item.versionCount, 1)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={downloadState === item.id}
                    onClick={() => handleDownload(item.signedUrlPath, item.id)}
                  >
                    {downloadState === item.id ? 'Hazırlanıyor...' : 'İndir'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Son Mesajlar</CardTitle>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <p className="text-sm text-slate-600">Henüz mesaj bulunmuyor.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {messages.map((item) => (
                <li key={item.id} className="rounded-md border border-border p-3">
                  <p className="text-slate-800">{item.body}</p>
                  <p className="mt-1 text-xs text-slate-500" suppressHydrationWarning>
                    {item.isOwnMessage ? 'Siz' : 'Ofis'} • {formatDateTR(item.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
