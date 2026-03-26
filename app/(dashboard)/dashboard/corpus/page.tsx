'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatDateTR } from '@/lib/date';

type CorpusSourceType = 'legislation' | 'case_law' | 'article' | 'internal_note';

type CorpusItem = {
  source_url: string | null;
  source_type: CorpusSourceType;
  citation: string | null;
  court_level: string | null;
  norm_hierarchy: string | null;
  case_id: string | null;
  segment_count: number;
  latest_created_at: string | null;
  first_collected_at: string | null;
  sample_doc_id: string;
};

type CorpusListResponse = {
  ingestion_mode: 'rag_indexing' | string;
  training_mode: 'no_fine_tuning' | string;
  corpus_scope: string;
  items: CorpusItem[];
};

type CorpusIngestResponse = {
  ingestion_mode: 'rag_indexing' | string;
  training_mode: 'no_fine_tuning' | string;
  corpus_scope: string;
  source_type: CorpusSourceType;
  source_url: string;
  parse_meta: {
    parser?: string;
    file_name?: string | null;
    pages?: number | null;
  };
  ingest_result: {
    doc_id: string | null;
    segments_created: number;
    citations_extracted: number;
    embedding_generated: boolean;
    enqueued_for_index: boolean;
    warnings: string[];
  };
};

type ReviewQueueStatus = 'pending' | 'in_review' | 'resolved' | 'rejected';
type ReviewQueueFilterStatus = ReviewQueueStatus | 'all';

type ReviewQueueItem = {
  id: string;
  status: ReviewQueueStatus;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  severity: string | null;
  confidence: number;
  created_at: string | null;
  due_at: string | null;
  assigned_to: string | null;
  resolved_at: string | null;
  closure_code: string | null;
  escalation_reason: string | null;
  reason_codes: string[];
  metadata: Record<string, unknown>;
};

type ReviewQueueResponse = {
  items: ReviewQueueItem[];
};

type ReviewDraft = {
  sla_minutes: string;
  closure_code: string;
  reviewer_feedback: string;
  escalation_reason: string;
};

const DEFAULT_REVIEW_DRAFT: ReviewDraft = {
  sla_minutes: '240',
  closure_code: 'approved',
  reviewer_feedback: '',
  escalation_reason: '',
};

const SOURCE_TYPE_LABEL: Record<CorpusSourceType, string> = {
  legislation: 'Mevzuat',
  case_law: 'Ictihat',
  article: 'Makale',
  internal_note: 'Ic Not',
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'Islem basarisiz oldu.';
  const body = payload as Record<string, unknown>;
  if (typeof body.error === 'string') return body.error;
  if (typeof body.detail === 'string') return body.detail;
  if (typeof body.message === 'string') return body.message;
  return 'Islem basarisiz oldu.';
}

export default function CorpusPage() {
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceType, setSourceType] = useState<CorpusSourceType>('article');
  const [citation, setCitation] = useState('');
  const [normHierarchy, setNormHierarchy] = useState('');
  const [courtLevel, setCourtLevel] = useState('');
  const [caseId, setCaseId] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [lastIngestResult, setLastIngestResult] = useState<CorpusIngestResponse | null>(null);
  const [reviewStatusFilter, setReviewStatusFilter] = useState<ReviewQueueFilterStatus>('pending');
  const [reviewActionTicketId, setReviewActionTicketId] = useState<string | null>(null);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const [reviewActionSuccess, setReviewActionSuccess] = useState<string | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery<CorpusListResponse, Error>({
    queryKey: ['dashboard', 'corpus', listQuery],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (listQuery.trim()) qs.set('q', listQuery.trim());
      qs.set('limit', '80');
      const response = await fetch(`/api/admin/corpus?${qs.toString()}`, {
        cache: 'no-store',
      });
      const payload = (await response.json()) as CorpusListResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Corpus listesi yuklenemedi.');
      }
      return {
        ingestion_mode: payload.ingestion_mode ?? 'rag_indexing',
        training_mode: payload.training_mode ?? 'no_fine_tuning',
        corpus_scope: payload.corpus_scope ?? 'unknown',
        items: payload.items ?? [],
      };
    },
  });

  const items = data?.items ?? [];
  const sourceTypeStats = useMemo(() => {
    const stats = {
      legislation: 0,
      case_law: 0,
      article: 0,
      internal_note: 0,
    } satisfies Record<CorpusSourceType, number>;
    for (const item of items) {
      stats[item.source_type] += 1;
    }
    return stats;
  }, [items]);

  const {
    data: reviewQueueData,
    isLoading: isReviewQueueLoading,
    isFetching: isReviewQueueFetching,
    isError: isReviewQueueError,
    error: reviewQueueError,
    refetch: refetchReviewQueue,
  } = useQuery<ReviewQueueResponse, Error>({
    queryKey: ['dashboard', 'corpus', 'reviewQueue', reviewStatusFilter],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (reviewStatusFilter !== 'all') qs.set('status', reviewStatusFilter);
      qs.set('limit', '80');
      const response = await fetch(`/api/rag/v3/review-queue?${qs.toString()}`, {
        cache: 'no-store',
      });
      const payload = (await response.json()) as ReviewQueueResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Review queue okunamadi.');
      }
      return {
        items: Array.isArray(payload.items) ? payload.items : [],
      };
    },
  });
  const reviewItems = reviewQueueData?.items ?? [];

  function reviewDraftFor(ticketId: string): ReviewDraft {
    return reviewDrafts[ticketId] ?? DEFAULT_REVIEW_DRAFT;
  }

  function updateReviewDraft(ticketId: string, patch: Partial<ReviewDraft>) {
    setReviewDrafts((prev) => ({
      ...prev,
      [ticketId]: {
        ...DEFAULT_REVIEW_DRAFT,
        ...(prev[ticketId] ?? {}),
        ...patch,
      },
    }));
  }

  async function handleAssignTicket(ticketId: string) {
    const draft = reviewDraftFor(ticketId);
    const slaRaw = draft.sla_minutes.trim();
    const slaMinutes = slaRaw ? Number(slaRaw) : Number.NaN;
    if (slaRaw && (!Number.isFinite(slaMinutes) || slaMinutes <= 0)) {
      setReviewActionError('SLA dakika alani pozitif tam sayi olmalidir.');
      setReviewActionSuccess(null);
      return;
    }

    setReviewActionTicketId(ticketId);
    setReviewActionError(null);
    setReviewActionSuccess(null);

    try {
      const response = await fetch(`/api/rag/v3/review-queue/${ticketId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sla_minutes: slaRaw ? Math.trunc(slaMinutes) : undefined,
          escalation_reason: draft.escalation_reason.trim() || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setReviewActionError(getErrorMessage(payload));
        return;
      }
      setReviewActionSuccess(`Ticket atandi: ${String(payload?.id ?? ticketId).slice(0, 8)}`);
      await queryClient.invalidateQueries({ queryKey: ['dashboard', 'corpus', 'reviewQueue'] });
      await refetchReviewQueue();
    } catch {
      setReviewActionError('Review assign istegi basarisiz oldu.');
    } finally {
      setReviewActionTicketId(null);
    }
  }

  async function handleCloseTicket(ticketId: string, status: 'resolved' | 'rejected') {
    const draft = reviewDraftFor(ticketId);
    const closureCode = draft.closure_code.trim();
    const feedback = draft.reviewer_feedback.trim();
    if (!closureCode) {
      setReviewActionError('closure_code zorunludur.');
      setReviewActionSuccess(null);
      return;
    }
    if (!feedback) {
      setReviewActionError('reviewer_feedback zorunludur.');
      setReviewActionSuccess(null);
      return;
    }

    setReviewActionTicketId(ticketId);
    setReviewActionError(null);
    setReviewActionSuccess(null);

    try {
      const response = await fetch(`/api/rag/v3/review-queue/${ticketId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          closure_code: closureCode,
          reviewer_feedback: feedback,
          escalation_reason: draft.escalation_reason.trim() || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setReviewActionError(getErrorMessage(payload));
        return;
      }
      setReviewActionSuccess(
        `Ticket kapatildi: ${String(payload?.id ?? ticketId).slice(0, 8)} (${String(payload?.status ?? status)})`,
      );
      await queryClient.invalidateQueries({ queryKey: ['dashboard', 'corpus', 'reviewQueue'] });
      await refetchReviewQueue();
    } catch {
      setReviewActionError('Review close istegi basarisiz oldu.');
    } finally {
      setReviewActionTicketId(null);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);
    setLastIngestResult(null);

    if (!sourceTitle.trim()) {
      setSubmitError('Kaynak basligi zorunludur.');
      return;
    }

    const normalizedCaseId = caseId.trim();
    if (normalizedCaseId && !isUuid(normalizedCaseId)) {
      setSubmitError('case_id UUID formatinda olmalidir.');
      return;
    }

    if (!rawText.trim() && !selectedFile) {
      setSubmitError('raw_text veya file alanindan en az biri dolu olmalidir.');
      return;
    }

    const formData = new FormData();
    formData.append('source_title', sourceTitle.trim());
    formData.append('source_type', sourceType);
    if (citation.trim()) formData.append('citation', citation.trim());
    if (normHierarchy.trim()) formData.append('norm_hierarchy', normHierarchy.trim());
    if (courtLevel.trim()) formData.append('court_level', courtLevel.trim());
    if (normalizedCaseId) formData.append('case_id', normalizedCaseId);
    if (sourceUrl.trim()) formData.append('source_url', sourceUrl.trim());
    if (rawText.trim()) formData.append('raw_text', rawText.trim());
    if (selectedFile) formData.append('file', selectedFile);

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/admin/corpus', {
        method: 'POST',
        body: formData,
      });

      const payload = (await response.json()) as CorpusIngestResponse & { error?: string };
      if (!response.ok) {
        setSubmitError(getErrorMessage(payload));
        return;
      }

      setLastIngestResult(payload);
      setSubmitSuccess(
        `Ingest tamamlandi: ${payload.ingest_result.doc_id ?? 'n/a'} | segment=${payload.ingest_result.segments_created}`,
      );
      setSourceTitle('');
      setCitation('');
      setNormHierarchy('');
      setCourtLevel('');
      setCaseId('');
      setSourceUrl('');
      setRawText('');
      setSelectedFile(null);
      await refetch();
    } catch {
      setSubmitError('Corpus ingest istegi basarisiz oldu.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="space-y-4">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Corpus Yonetimi (Admin)</CardTitle>
          <p className="text-sm text-slate-600">
            Bu ekran model egitimi yapmaz. Yalnizca buro bazli RAG indexing yapar.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted" className="text-xs">
              ingest: {data?.ingestion_mode ?? 'rag_indexing'}
            </Badge>
            <Badge variant="muted" className="text-xs">
              training: {data?.training_mode ?? 'no_fine_tuning'}
            </Badge>
            <Badge variant="muted" className="text-xs">
              scope: {data?.corpus_scope ?? 'bureau_internal'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                placeholder="Kaynak basligi (zorunlu)"
                value={sourceTitle}
                onChange={(event) => setSourceTitle(event.target.value)}
                disabled={isSubmitting}
                required
              />

              <select
                value={sourceType}
                onChange={(event) => setSourceType(event.target.value as CorpusSourceType)}
                disabled={isSubmitting}
                className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="legislation">Mevzuat</option>
                <option value="case_law">Ictihat</option>
                <option value="article">Makale</option>
                <option value="internal_note">Ic Not</option>
              </select>

              <Input
                placeholder="Atif (opsiyonel)"
                value={citation}
                onChange={(event) => setCitation(event.target.value)}
                disabled={isSubmitting}
              />
              <Input
                placeholder="Norm hiyerarsi (opsiyonel)"
                value={normHierarchy}
                onChange={(event) => setNormHierarchy(event.target.value)}
                disabled={isSubmitting}
              />
              <Input
                placeholder="Mahkeme seviyesi (opsiyonel)"
                value={courtLevel}
                onChange={(event) => setCourtLevel(event.target.value)}
                disabled={isSubmitting}
              />
              <Input
                placeholder="Case UUID (opsiyonel)"
                value={caseId}
                onChange={(event) => setCaseId(event.target.value)}
                disabled={isSubmitting}
              />
              <Input
                placeholder="source_url override (opsiyonel)"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                disabled={isSubmitting}
              />
              <Input
                type="file"
                accept=".pdf,.txt,.md,.rtf,.csv,.json,.xml,.html,.htm,.log"
                disabled={isSubmitting}
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setSelectedFile(nextFile);
                }}
              />
            </div>

            <textarea
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              rows={8}
              disabled={isSubmitting}
              placeholder="Raw text (opsiyonel, dosya secmediysen zorunlu)"
              className="w-full resize-y rounded-xl border border-[var(--color-legal-border)] bg-[var(--color-legal-surface)] px-4 py-2.5 text-sm text-[var(--color-legal-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-legal-action)] focus-visible:ring-offset-2"
            />

            {selectedFile && (
              <p className="text-xs text-slate-600">
                Secilen dosya: {selectedFile.name}
              </p>
            )}

            {submitError && <p className="text-sm text-red-700">{submitError}</p>}
            {submitSuccess && <p className="text-sm text-green-700">{submitSuccess}</p>}
            {lastIngestResult && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <p>doc_id: {lastIngestResult.ingest_result.doc_id ?? 'n/a'}</p>
                <p>segments: {lastIngestResult.ingest_result.segments_created}</p>
                <p>citations: {lastIngestResult.ingest_result.citations_extracted}</p>
                <p>embedding: {String(lastIngestResult.ingest_result.embedding_generated)}</p>
                <p>enqueued_for_index: {String(lastIngestResult.ingest_result.enqueued_for_index)}</p>
                <p>parser: {lastIngestResult.parse_meta.parser ?? 'unknown'}</p>
              </div>
            )}

            <div className="flex items-center justify-end">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Ingest ediliyor...' : 'Corpora Ekle'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Corpus Kayitlari</CardTitle>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Kayit ara..."
                value={listQuery}
                onChange={(event) => setListQuery(event.target.value)}
                className="w-56"
              />
              <Button type="button" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                Yenile
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="muted">Toplam: {items.length}</Badge>
            <Badge variant="muted">Mevzuat: {sourceTypeStats.legislation}</Badge>
            <Badge variant="muted">Ictihat: {sourceTypeStats.case_law}</Badge>
            <Badge variant="muted">Makale: {sourceTypeStats.article}</Badge>
            <Badge variant="muted">Ic Not: {sourceTypeStats.internal_note}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-600">Yukleniyor...</p>
          ) : isError ? (
            <p className="text-sm text-red-700">{error?.message ?? 'Corpus listesi okunamadi.'}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-600">Kayit bulunamadi.</p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={`${item.sample_doc_id}-${item.source_url ?? ''}`} className="rounded-md border border-slate-200 p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant="muted">{SOURCE_TYPE_LABEL[item.source_type]}</Badge>
                    <span className="text-xs text-slate-500">segment: {item.segment_count}</span>
                    {item.case_id && <Badge variant="muted">case: {item.case_id.slice(0, 8)}</Badge>}
                  </div>
                  <p className="text-sm font-medium text-slate-800">{item.citation ?? item.source_url ?? 'Corpus kaydi'}</p>
                  <p className="mt-1 break-all text-xs text-slate-600">{item.source_url ?? 'n/a'}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.latest_created_at ? `Guncelleme: ${formatDateTR(item.latest_created_at)}` : 'Guncelleme: n/a'}
                    {' | '}
                    {item.first_collected_at ? `Toplanma: ${formatDateTR(item.first_collected_at)}` : 'Toplanma: n/a'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>RAG v3 Human Review Queue</CardTitle>
            <div className="flex items-center gap-2">
              <select
                value={reviewStatusFilter}
                onChange={(event) => setReviewStatusFilter(event.target.value as ReviewQueueFilterStatus)}
                className="flex h-10 rounded-md border border-input bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="pending">pending</option>
                <option value="in_review">in_review</option>
                <option value="resolved">resolved</option>
                <option value="rejected">rejected</option>
                <option value="all">all</option>
              </select>
              <Button type="button" variant="outline" onClick={() => refetchReviewQueue()} disabled={isReviewQueueFetching}>
                Yenile
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="muted">Filtre: {reviewStatusFilter}</Badge>
            <Badge variant="muted">Toplam: {reviewItems.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {reviewActionError && <p className="mb-2 text-sm text-red-700">{reviewActionError}</p>}
          {reviewActionSuccess && <p className="mb-2 text-sm text-green-700">{reviewActionSuccess}</p>}
          {isReviewQueueLoading ? (
            <p className="text-sm text-slate-600">Queue yukleniyor...</p>
          ) : isReviewQueueError ? (
            <p className="text-sm text-red-700">{reviewQueueError?.message ?? 'Review queue okunamadi.'}</p>
          ) : reviewItems.length === 0 ? (
            <p className="text-sm text-slate-600">Review queue kaydi bulunamadi.</p>
          ) : (
            <ul className="space-y-3">
              {reviewItems.map((ticket) => {
                const isClosed = ticket.status === 'resolved' || ticket.status === 'rejected';
                const isBusy = reviewActionTicketId === ticket.id;
                const draft = reviewDraftFor(ticket.id);
                return (
                  <li key={ticket.id} className="rounded-md border border-slate-200 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="muted">{ticket.status}</Badge>
                      {ticket.risk_level && <Badge variant="muted">risk: {ticket.risk_level}</Badge>}
                      {ticket.severity && <Badge variant="muted">sev: {ticket.severity}</Badge>}
                      <Badge variant="muted">conf: {Number(ticket.confidence ?? 0).toFixed(2)}</Badge>
                    </div>
                    <p className="text-xs text-slate-600">
                      id: {ticket.id}
                      {ticket.assigned_to ? ` | assigned_to: ${ticket.assigned_to}` : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      created: {ticket.created_at ? formatDateTR(ticket.created_at) : 'n/a'}
                      {' | '}
                      due: {ticket.due_at ? formatDateTR(ticket.due_at) : 'n/a'}
                      {' | '}
                      resolved: {ticket.resolved_at ? formatDateTR(ticket.resolved_at) : 'n/a'}
                    </p>
                    {ticket.reason_codes.length > 0 && (
                      <p className="mt-1 text-xs text-slate-600">reason_codes: {ticket.reason_codes.join(', ')}</p>
                    )}
                    {ticket.escalation_reason && (
                      <p className="mt-1 text-xs text-slate-600">escalation_reason: {ticket.escalation_reason}</p>
                    )}
                    {isClosed ? (
                      <div className="mt-2 rounded-md bg-slate-50 p-2 text-xs text-slate-700">
                        <p>closure_code: {ticket.closure_code ?? 'n/a'}</p>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <div className="grid gap-2 md:grid-cols-3">
                          <Input
                            value={draft.sla_minutes}
                            onChange={(event) => updateReviewDraft(ticket.id, { sla_minutes: event.target.value })}
                            placeholder="SLA (dakika)"
                            disabled={isBusy}
                          />
                          <Input
                            value={draft.closure_code}
                            onChange={(event) => updateReviewDraft(ticket.id, { closure_code: event.target.value })}
                            placeholder="closure_code"
                            disabled={isBusy}
                          />
                          <Input
                            value={draft.escalation_reason}
                            onChange={(event) => updateReviewDraft(ticket.id, { escalation_reason: event.target.value })}
                            placeholder="escalation_reason (opsiyonel)"
                            disabled={isBusy}
                          />
                        </div>
                        <textarea
                          value={draft.reviewer_feedback}
                          onChange={(event) => updateReviewDraft(ticket.id, { reviewer_feedback: event.target.value })}
                          rows={3}
                          disabled={isBusy}
                          placeholder="reviewer_feedback (close icin zorunlu)"
                          className="w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm text-slate-700"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" variant="outline" disabled={isBusy} onClick={() => handleAssignTicket(ticket.id)}>
                            Kendime Ata
                          </Button>
                          <Button type="button" disabled={isBusy} onClick={() => handleCloseTicket(ticket.id, 'resolved')}>
                            Resolved
                          </Button>
                          <Button type="button" variant="outline" disabled={isBusy} onClick={() => handleCloseTicket(ticket.id, 'rejected')}>
                            Rejected
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
