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

const USERNAME_PATTERN = /^[a-z0-9._]+$/;

type ClientItem = {
  id: string;
  fullName: string;
  email: string | null;
  fileNo: string | null;
  publicRefCode: string | null;
  status: 'registered' | 'invited';
  createdAt: string;
  updatedAt: string;
  caseCount: number;
  openCaseCount: number;
};

type ClientInviteItem = {
  id: string;
  fullName: string | null;
  username: string | null;
  tcIdentity: string | null;
  contactName: string | null;
  phone: string | null;
  partyType: 'plaintiff' | 'defendant' | 'consultant' | null;
  email: string;
  targetRole: 'client';
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  invitedClientId?: string | null;
};

type ClientDraftStatus = 'draft' | 'approved' | 'archived';

type ClientDraftItem = {
  id: string;
  action: 'translate_for_client_draft' | 'save_client_draft';
  status: ClientDraftStatus;
  title: string | null;
  content: string;
  contentPreview: string;
  caseId: string | null;
  caseTitle: string | null;
  clientId: string | null;
  clientName: string | null;
  ownerUserId: string;
  ownerName: string | null;
  sourceMessageId: string | null;
  sourceSavedOutputId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export default function ClientsPage() {
  const [query, setQuery] = useState('');
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteTcIdentity, setInviteTcIdentity] = useState('');
  const [inviteContactName, setInviteContactName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [invitePartyType, setInvitePartyType] = useState<'' | 'plaintiff' | 'defendant' | 'consultant'>('');
  const [inviteFileNo, setInviteFileNo] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDays, setInviteDays] = useState(7);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);
  const [linkedCasesModal, setLinkedCasesModal] = useState<{ clientId: string; fullName: string } | null>(null);
  const [linkedCases, setLinkedCases] = useState<
    Array<{ id: string; title: string; status: string; fileNo: string | null; updatedAt: string; publicRefCode: string }>
  >([]);
  const [isLoadingLinkedCases, setIsLoadingLinkedCases] = useState(false);
  const [messageModalClient, setMessageModalClient] = useState<{ clientId: string; fullName: string } | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [messageCaseId, setMessageCaseId] = useState('');
  const [sendAsEmail, setSendAsEmail] = useState(true);
  const [messageAction, setMessageAction] = useState<string | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [draftStatusFilter, setDraftStatusFilter] = useState<ClientDraftStatus | 'all'>('all');
  const [draftActionMessage, setDraftActionMessage] = useState<string | null>(null);
  const [isUpdatingDraftId, setIsUpdatingDraftId] = useState<string | null>(null);

  const normalizedInviteUsername = inviteUsername.trim().toLowerCase();
  const isInviteUsernameProvided = normalizedInviteUsername.length > 0;
  const isInviteUsernameLengthValid = normalizedInviteUsername.length >= 3;
  const isInviteUsernameFormatValid = USERNAME_PATTERN.test(normalizedInviteUsername);
  const isInviteUsernameValid =
    !isInviteUsernameProvided || (isInviteUsernameLengthValid && isInviteUsernameFormatValid);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<
    {
      clients: ClientItem[];
      invites: ClientInviteItem[];
    },
    Error
  >({
    queryKey: ['dashboard', 'clients'],
    queryFn: async () => {
      const response = await fetch('/api/dashboard/clients', { cache: 'no-store' });
      const payload = (await response.json()) as {
        clients?: ClientItem[];
        invites?: ClientInviteItem[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? 'MÃ¼vekkil verileri alÄ±namadÄ±.');
      }

      return {
        clients: payload.clients ?? [],
        invites: payload.invites ?? [],
      };
    },
  });

  const {
    data: draftsPayload,
    isLoading: draftsLoading,
    isError: draftsIsError,
    error: draftsError,
    refetch: refetchDrafts,
    isFetching: draftsIsFetching,
  } = useQuery<
    {
      drafts: ClientDraftItem[];
      summary: { total: number; draft: number; approved: number; archived: number };
      viewerRole: 'lawyer' | 'assistant';
    },
    Error
  >({
    queryKey: ['dashboard', 'clients', 'drafts', draftStatusFilter],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (draftStatusFilter !== 'all') {
        qs.set('status', draftStatusFilter);
      }
      qs.set('limit', '80');
      const response = await fetch(`/api/dashboard/clients/drafts?${qs.toString()}`, {
        cache: 'no-store',
      });
      const payload = (await response.json()) as {
        drafts?: ClientDraftItem[];
        summary?: { total: number; draft: number; approved: number; archived: number };
        viewerRole?: 'lawyer' | 'assistant';
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Muvekkil taslaklari alinamadi.');
      }
      return {
        drafts: payload.drafts ?? [],
        summary: payload.summary ?? { total: 0, draft: 0, approved: 0, archived: 0 },
        viewerRole: payload.viewerRole ?? 'assistant',
      };
    },
  });

  const clients = data?.clients ?? [];
  const invites = data?.invites ?? [];
  const clientDrafts = draftsPayload?.drafts ?? [];
  const draftSummary = draftsPayload?.summary ?? { total: 0, draft: 0, approved: 0, archived: 0 };
  const viewerRole = draftsPayload?.viewerRole ?? 'assistant';

  const stats = useMemo(() => {
    const acceptedInvites = invites.filter((item) => Boolean(item.acceptedAt)).length;
    const pendingInvites = invites.filter((item) => !item.acceptedAt).length;
    const activeCases = clients.reduce((acc, item) => acc + item.openCaseCount, 0);
    return {
      totalClients: clients.length,
      activeCases,
      pendingInvites,
      acceptedInvites,
    };
  }, [clients, invites]);

  const filteredClients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return clients;
    }

    return clients.filter((item) => {
      const haystack = `${item.fullName} ${item.email ?? ''} ${item.fileNo ?? ''} ${item.publicRefCode ?? ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [clients, query]);

  async function updateDraftStatus(draftId: string, status: ClientDraftStatus) {
    setIsUpdatingDraftId(draftId);
    setDraftActionMessage(null);

    try {
      const response = await fetch('/api/dashboard/clients/drafts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId,
          status,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setDraftActionMessage(payload.error ?? 'Taslak durumu guncellenemedi.');
        return;
      }
      setDraftActionMessage(
        status === 'approved'
          ? 'Taslak avukat onayi ile onaylandi.'
          : status === 'archived'
            ? 'Taslak arsivlendi.'
            : 'Taslak yeniden duzenleme moduna alindi.',
      );
      await refetchDrafts();
    } catch {
      setDraftActionMessage('Taslak durumu guncellenirken ag hatasi olustu.');
    } finally {
      setIsUpdatingDraftId(null);
    }
  }

  async function openClientCases(clientId: string, fullName: string) {
    setLinkedCasesModal({ clientId, fullName });
    setLinkedCases([]);
    setIsLoadingLinkedCases(true);
    setActionMessage(null);

    try {
      const response = await fetch(`/api/dashboard/clients/${clientId}/cases`, { cache: 'no-store' });
      const payload = (await response.json()) as {
        items?: Array<{ id: string; title: string; status: string; fileNo: string | null; updatedAt: string; publicRefCode: string }>;
        error?: string;
      };

      if (!response.ok) {
        setActionMessage(payload.error ?? 'MÃ¼vekkil dosyalarÄ± alÄ±namadÄ±.');
        return;
      }

      setLinkedCases(payload.items ?? []);
    } catch {
      setActionMessage('MÃ¼vekkil dosyalarÄ± yÃ¼klenirken aÄŸ hatasÄ± oluÅŸtu.');
    } finally {
      setIsLoadingLinkedCases(false);
    }
  }

  async function submitClientMessage() {
    if (!messageModalClient || !messageBody.trim()) {
      setMessageAction('Mesaj metni boÅŸ olamaz.');
      return;
    }

    setIsSendingMessage(true);
    setMessageAction(null);

    try {
      const response = await fetch(`/api/dashboard/clients/${messageModalClient.clientId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: messageBody.trim(),
          caseId: messageCaseId.trim() || undefined,
          sendEmailAlso: sendAsEmail,
        }),
      });

      const payload = (await response.json()) as {
        message?: { status?: 'pending' | 'sent' | 'failed'; emailError?: string | null };
        error?: string;
      };

      if (!response.ok) {
        setMessageAction(payload.error ?? 'Mesaj gÃ¶nderilemedi.');
        return;
      }

      const status = payload.message?.status ?? 'pending';
      setMessageAction(
        status === 'failed'
          ? `Mesaj kaydedildi ancak teslimde sorun var: ${payload.message?.emailError ?? 'Teslim baÅŸarÄ±sÄ±z.'}`
          : status === 'sent'
            ? 'Mesaj gÃ¶nderildi.'
            : 'Mesaj beklemeye alÄ±ndÄ±.',
      );
      setMessageBody('');
      setMessageCaseId('');
    } catch {
      setMessageAction('Mesaj gÃ¶nderimi sÄ±rasÄ±nda aÄŸ hatasÄ± oluÅŸtu.');
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function submitClientInvite() {
    if (inviteFullName.trim().length < 3) {
      setActionMessage('LÃ¼tfen mÃ¼vekkil ad soyad bilgisini girin.');
      return;
    }

    if (!inviteEmail.trim()) {
      setActionMessage('LÃ¼tfen geÃ§erli bir e-posta girin.');
      return;
    }

    if (!isInviteUsernameValid) {
      setActionMessage('KullanÄ±cÄ± adÄ± sadece a-z, 0-9, . ve _ iÃ§erebilir; girildiyse en az 3 karakter olmalÄ±.');
      return;
    }

    setIsSubmittingInvite(true);
    setActionMessage(null);
    setInviteUrl(null);

    try {
      const response = await fetch('/api/dashboard/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: inviteFullName.trim(),
          username: normalizedInviteUsername || undefined,
          tcIdentity: inviteTcIdentity.trim() || undefined,
          contactName: inviteContactName.trim() || undefined,
          phone: invitePhone.trim() || undefined,
          partyType: invitePartyType || undefined,
          fileNo: inviteFileNo.trim() || undefined,
          email: inviteEmail.trim(),
          expiresInDays: inviteDays,
        }),
      });

      const payload = (await response.json()) as { error?: string; inviteUrl?: string };
      if (!response.ok) {
        setActionMessage(payload.error ?? 'MÃ¼vekkil daveti gÃ¶nderilemedi.');
        return;
      }

      setActionMessage('MÃ¼vekkil daveti oluÅŸturuldu.');
      setInviteUrl(payload.inviteUrl ?? null);
      setInviteFullName('');
      setInviteUsername('');
      setInviteTcIdentity('');
      setInviteContactName('');
      setInvitePhone('');
      setInvitePartyType('');
      setInviteFileNo('');
      setInviteEmail('');
      setInviteDays(7);
      await refetch();
    } catch {
      setActionMessage('MÃ¼vekkil daveti gÃ¶nderilirken hata oluÅŸtu.');
    } finally {
      setIsSubmittingInvite(false);
    }
  }

  return (
    <div className="space-y-4 text-[var(--text)]">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>MÃ¼vekkil YÃ¶netimi</CardTitle>
              <p className="text-sm text-slate-500">MÃ¼vekkil listenizi takip edin, yeni mÃ¼vekkil daveti oluÅŸturun.</p>
            </div>
            <Button
              type="button"
              onClick={() => {
                setInviteModalOpen(true);
                setActionMessage(null);
                setInviteUrl(null);
              }}
              className="h-11 rounded-xl bg-gradient-to-r from-blue-600 to-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-slate-950"
            >
              + MÃ¼vekkil Ekle (Davet)
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <p className="text-xs text-slate-500">Toplam MÃ¼vekkil</p>
              <p className="text-xl font-semibold text-slate-900">{isLoading ? '...' : stats.totalClients}</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              <p className="text-xs text-blue-700">Aktif Dosya</p>
              <p className="text-xl font-semibold text-blue-900">{isLoading ? '...' : stats.activeCases}</p>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm">
              <p className="text-xs text-orange-700">Bekleyen Davet</p>
              <p className="text-xl font-semibold text-orange-900">{isLoading ? '...' : stats.pendingInvites}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
              <p className="text-xs text-emerald-700">Kabul Edilen Davet</p>
              <p className="text-xl font-semibold text-emerald-900">{isLoading ? '...' : stats.acceptedInvites}</p>
            </div>
          </div>

          <Input
            placeholder="MÃ¼vekkil adÄ±na gÃ¶re ara"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : isError ? (
            <p className="text-sm text-orange-600">
              {error instanceof Error ? error.message : 'MÃ¼vekkiller alÄ±namadÄ±.'}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left">
                    <tr>
                      <th className="px-4 py-3">Muvekkil</th>
                      <th className="px-4 py-3">Dosya</th>
                      <th className="px-4 py-3">Referans</th>
                      <th className="px-4 py-3">Durum</th>
                      <th className="px-4 py-3">Son Guncelleme</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClients.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                          Muvekkil bulunamadi.
                        </td>
                      </tr>
                    ) : (
                      filteredClients.map((item) => (
                        <tr key={item.id} className="border-t border-border hover:bg-slate-50/60">
                          <td className="px-4 py-3">
                            <Link href={`/dashboard/clients/${item.id}` as Route} className="font-medium text-blue-700 hover:underline">
                              {item.fullName}
                            </Link>
                            <p className="text-xs text-slate-500">{item.email ?? '-'}</p>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="blue">Toplam: {item.caseCount}</Badge>
                              <Badge variant={item.openCaseCount > 0 ? 'orange' : 'muted'}>
                                Acik: {item.openCaseCount}
                              </Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => openClientCases(item.id, item.fullName)}
                              >
                                Dosyalari
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setMessageModalClient({ clientId: item.id, fullName: item.fullName });
                                  setMessageAction(null);
                                  setMessageBody('');
                                  setMessageCaseId('');
                                  setSendAsEmail(true);
                                }}
                              >
                                Mesaj Gonder
                              </Button>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-1 text-xs text-slate-600">
                              <p>Client Ref: {item.publicRefCode ?? '-'}</p>
                              <p>Dosya No: {item.fileNo ?? '-'}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={item.openCaseCount > 0 ? 'orange' : 'muted'}>
                              {item.openCaseCount > 0 ? 'Aktif Surecte' : 'Pasif'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-slate-600" suppressHydrationWarning>
                            {formatDateTR(item.updatedAt)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Son MÃ¼vekkil Davetleri</p>
                  <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
                    Yenile
                  </Button>
                </div>
                {invites.length === 0 ? (
                  <p className="text-xs text-slate-500">HenÃ¼z mÃ¼vekkil daveti oluÅŸturulmadÄ±.</p>
                ) : (
                  <ul className="space-y-2 text-xs">
                    {invites.slice(0, 8).map((invite) => (
                      <li
                        key={invite.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
                      >
                        <div>
                          <p className="font-medium text-slate-700">{invite.fullName ?? invite.email}</p>
                          <p className="text-slate-600">
                            {invite.username ? `@${invite.username} Â· ${invite.email}` : invite.email}
                          </p>
                          {invite.tcIdentity || invite.contactName || invite.phone || invite.partyType ? (
                            <p className="text-slate-500">
                              {invite.tcIdentity ? `TC/VKN: ${invite.tcIdentity}` : null}
                              {invite.tcIdentity && (invite.contactName || invite.phone || invite.partyType)
                                ? ' Â· '
                                : null}
                              {invite.contactName ? `Ä°letiÅŸim: ${invite.contactName}` : null}
                              {invite.contactName && (invite.phone || invite.partyType) ? ' Â· ' : null}
                              {invite.phone ? `Tel: ${invite.phone}` : null}
                              {invite.phone && invite.partyType ? ' Â· ' : null}
                              {invite.partyType
                                ? invite.partyType === 'plaintiff'
                                  ? 'DavacÄ±'
                                  : invite.partyType === 'defendant'
                                    ? 'DavalÄ±'
                                    : 'DanÄ±ÅŸan'
                                : null}
                            </p>
                          ) : null}
                          <p className="text-slate-500" suppressHydrationWarning>
                            OluÅŸturma: {formatDateTR(invite.createdAt)} Â· Son: {formatDateTR(invite.expiresAt)}
                          </p>
                        </div>
                        <Badge variant={invite.acceptedAt ? 'blue' : 'orange'}>
                          {invite.acceptedAt ? 'Kabul edildi' : 'Beklemede'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-blue-700">
                      Muvekkil Taslaklari (AI)
                    </p>
                    <p className="text-xs text-blue-700/80">
                      Muvekkile gitmeden once avukat onayi zorunludur. (MVP: otomatik gonderim yok)
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={draftStatusFilter}
                      onChange={(event) => setDraftStatusFilter(event.target.value as ClientDraftStatus | 'all')}
                      className="h-8 rounded-md border border-blue-200 bg-white px-2 text-xs text-slate-700"
                    >
                      <option value="all">Tum durumlar</option>
                      <option value="draft">Taslak</option>
                      <option value="approved">Onayli</option>
                      <option value="archived">Arsiv</option>
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={draftsIsFetching}
                      onClick={() => refetchDrafts()}
                    >
                      Yenile
                    </Button>
                  </div>
                </div>

                <div className="mb-2 flex flex-wrap gap-2 text-xs">
                  <Badge variant="blue">Toplam: {draftSummary.total}</Badge>
                  <Badge variant="orange">Taslak: {draftSummary.draft}</Badge>
                  <Badge variant="blue">Onayli: {draftSummary.approved}</Badge>
                  <Badge variant="muted">Arsiv: {draftSummary.archived}</Badge>
                </div>

                {draftActionMessage ? <p className="mb-2 text-xs text-blue-800">{draftActionMessage}</p> : null}

                {draftsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : draftsIsError ? (
                  <p className="text-xs text-orange-700">
                    {draftsError instanceof Error ? draftsError.message : 'Taslaklar alinamadi.'}
                  </p>
                ) : clientDrafts.length === 0 ? (
                  <p className="text-xs text-blue-800/80">Bu filtrede gosterilecek taslak bulunmuyor.</p>
                ) : (
                  <ul className="space-y-2 text-xs">
                    {clientDrafts.slice(0, 20).map((draft) => (
                      <li key={draft.id} className="rounded-md border border-blue-100 bg-white px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-medium text-slate-900">{draft.title ?? 'Muvekkil Taslagi'}</p>
                            <p className="text-slate-600">
                              {draft.clientName ?? 'Muvekkil baglanmamis'}{' '}
                              {draft.caseTitle ? `Â· ${draft.caseTitle}` : ''}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge
                              variant={
                                draft.status === 'approved' ? 'blue' : draft.status === 'archived' ? 'muted' : 'orange'
                              }
                            >
                              {draft.status === 'approved'
                                ? 'Onayli'
                                : draft.status === 'archived'
                                  ? 'Arsiv'
                                  : 'Taslak'}
                            </Badge>
                            <Badge variant="muted">
                              {draft.action === 'translate_for_client_draft' ? 'Sadelestirme' : 'Kayit'}
                            </Badge>
                          </div>
                        </div>

                        <p className="mt-1 whitespace-pre-wrap text-slate-700">{draft.contentPreview}</p>
                        <div className="mt-1 text-[11px] text-slate-500" suppressHydrationWarning>
                          Olusturma: {formatDateTR(draft.createdAt)} Â· Guncelleme: {formatDateTR(draft.updatedAt)}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          trace: msg={draft.sourceMessageId ? draft.sourceMessageId.slice(0, 8) : '-'} Â· out=
                          {draft.sourceSavedOutputId ? draft.sourceSavedOutputId.slice(0, 8) : '-'}
                          {draft.ownerName ? ` Â· olusturan: ${draft.ownerName}` : ''}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          {viewerRole === 'lawyer' && draft.status !== 'approved' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isUpdatingDraftId === draft.id}
                              onClick={() => updateDraftStatus(draft.id, 'approved')}
                            >
                              Avukat Onayi Ver
                            </Button>
                          )}
                          {draft.status === 'approved' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isUpdatingDraftId === draft.id}
                              onClick={() => updateDraftStatus(draft.id, 'draft')}
                            >
                              Tekrar Taslak
                            </Button>
                          )}
                          {draft.status !== 'archived' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isUpdatingDraftId === draft.id}
                              onClick={() => updateDraftStatus(draft.id, 'archived')}
                            >
                              Arsivle
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {inviteModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">MÃ¼vekkil Daveti OluÅŸtur</h3>
            <p className="mt-1 text-sm text-slate-600">Yeni mÃ¼vekkili davet ederek kayÄ±t akÄ±ÅŸÄ±na yÃ¶nlendirin.</p>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Ad Soyad
                </label>
                <Input
                  value={inviteFullName}
                  onChange={(event) => setInviteFullName(event.target.value)}
                  placeholder="Ã–rn. AyÅŸe YÄ±lmaz"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  KullanÄ±cÄ± AdÄ± (Opsiyonel)
                </label>
                <Input
                  value={inviteUsername}
                  onChange={(event) => setInviteUsername(event.target.value.toLowerCase())}
                  placeholder="ayseyilmaz"
                />
                {isInviteUsernameProvided && !isInviteUsernameValid ? (
                  <p className="mt-1 text-xs text-orange-600">Sadece a-z, 0-9, . ve _ kullanÄ±n; minimum 3 karakter.</p>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    TC / VKN (Opsiyonel)
                  </label>
                  <Input
                    value={inviteTcIdentity}
                    onChange={(event) => setInviteTcIdentity(event.target.value)}
                    placeholder="12345678901"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Ä°letiÅŸim KiÅŸisi (Opsiyonel)
                  </label>
                  <Input
                    value={inviteContactName}
                    onChange={(event) => setInviteContactName(event.target.value)}
                    placeholder="Ã–rn. Mehmet Kaya"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Telefon (Opsiyonel)
                  </label>
                  <Input
                    value={invitePhone}
                    onChange={(event) => setInvitePhone(event.target.value)}
                    placeholder="05xx xxx xx xx"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Dosya No (Opsiyonel)
                  </label>
                  <Input
                    value={inviteFileNo}
                    onChange={(event) => setInviteFileNo(event.target.value)}
                    placeholder="Orn. 2026/145"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Taraf Tipi (Opsiyonel)
                  </label>
                  <select
                    value={invitePartyType}
                    onChange={(event) =>
                      setInvitePartyType(event.target.value as '' | 'plaintiff' | 'defendant' | 'consultant')
                    }
                    className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                  >
                    <option value="">Belirtilmedi</option>
                    <option value="plaintiff">DavacÄ±</option>
                    <option value="defendant">DavalÄ±</option>
                    <option value="consultant">DanÄ±ÅŸan</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">E-Posta</label>
                <Input
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="ornek@domain.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  GeÃ§erlilik (GÃ¼n)
                </label>
                <select
                  value={inviteDays}
                  onChange={(event) => setInviteDays(Number(event.target.value))}
                  className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                >
                  <option value={3}>3 gÃ¼n</option>
                  <option value={7}>7 gÃ¼n</option>
                  <option value={14}>14 gÃ¼n</option>
                  <option value={30}>30 gÃ¼n</option>
                </select>
              </div>
            </div>

            {actionMessage ? <p className="mt-3 text-xs text-slate-600">{actionMessage}</p> : null}
            {inviteUrl ? (
              <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-700">
                Davet baÄŸlantÄ±sÄ±:{' '}
                <a href={inviteUrl} className="font-medium underline">
                  {inviteUrl}
                </a>
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setInviteModalOpen(false);
                  setInviteFullName('');
                  setInviteUsername('');
                  setInviteTcIdentity('');
                  setInviteContactName('');
                  setInvitePhone('');
                  setInvitePartyType('');
                  setInviteFileNo('');
                  setInviteEmail('');
                  setInviteDays(7);
                  setActionMessage(null);
                  setInviteUrl(null);
                }}
              >
                Kapat
              </Button>
              <Button
                type="button"
                disabled={
                  isSubmittingInvite ||
                  inviteFullName.trim().length < 3 ||
                  inviteEmail.trim().length < 5 ||
                  !isInviteUsernameValid
                }
                onClick={submitClientInvite}
              >
                Davet OluÅŸtur
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {linkedCasesModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{linkedCasesModal.fullName} - Bagli Dosyalar</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setLinkedCasesModal(null);
                  setLinkedCases([]);
                }}
              >
                Kapat
              </Button>
            </div>

            {isLoadingLinkedCases ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : linkedCases.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Bu muvekkile bagli dosya bulunamadi.
              </p>
            ) : (
              <ul className="max-h-[360px] space-y-2 overflow-y-auto">
                {linkedCases.map((item) => (
                  <li key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{item.title}</p>
                        <p className="text-xs text-slate-600">
                          Ref: {item.publicRefCode} Â· Dosya No: {item.fileNo ?? '-'}
                        </p>
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
          </div>
        </div>
      ) : null}

      {messageModalClient ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">{messageModalClient.fullName} - Mesaj Gonder</h3>
            <p className="mt-1 text-xs text-slate-600">Mesaj uygulama ici kaydedilir. Isterseniz e-posta olarak da gonderilir.</p>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Case ID (opsiyonel)</label>
                <Input value={messageCaseId} onChange={(event) => setMessageCaseId(event.target.value)} placeholder="Orn: 07992d5c-b38d..." />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Mesaj</label>
                <textarea
                  value={messageBody}
                  onChange={(event) => setMessageBody(event.target.value)}
                  className="min-h-[120px] w-full rounded-md border border-input px-3 py-2 text-sm"
                  placeholder="Muvekkile iletilecek mesaj..."
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={sendAsEmail} onChange={(event) => setSendAsEmail(event.target.checked)} />
                E-posta olarak da gonder
              </label>
            </div>

            {messageAction ? <p className="mt-2 text-xs text-slate-600">{messageAction}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setMessageModalClient(null);
                  setMessageBody('');
                  setMessageCaseId('');
                  setSendAsEmail(true);
                  setMessageAction(null);
                }}
              >
                Kapat
              </Button>
              <Button type="button" disabled={isSendingMessage || !messageBody.trim()} onClick={submitClientMessage}>
                {isSendingMessage ? 'Gonderiliyor...' : 'Mesaj Gonder'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}



