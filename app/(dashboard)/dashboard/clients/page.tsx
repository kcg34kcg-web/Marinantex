'use client';

import { useMemo, useState } from 'react';
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
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDays, setInviteDays] = useState(7);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);

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
        throw new Error(payload.error ?? 'Müvekkil verileri alınamadı.');
      }

      return {
        clients: payload.clients ?? [],
        invites: payload.invites ?? [],
      };
    },
  });

  const clients = data?.clients ?? [];
  const invites = data?.invites ?? [];

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

    return clients.filter((item) => item.fullName.toLowerCase().includes(normalized));
  }, [clients, query]);

  async function submitClientInvite() {
    if (inviteFullName.trim().length < 3) {
      setActionMessage('Lütfen müvekkil ad soyad bilgisini girin.');
      return;
    }

    if (!inviteEmail.trim()) {
      setActionMessage('Lütfen geçerli bir e-posta girin.');
      return;
    }

    if (!isInviteUsernameValid) {
      setActionMessage('Kullanıcı adı sadece a-z, 0-9, . ve _ içerebilir; girildiyse en az 3 karakter olmalı.');
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
          email: inviteEmail.trim(),
          expiresInDays: inviteDays,
        }),
      });

      const payload = (await response.json()) as { error?: string; inviteUrl?: string };
      if (!response.ok) {
        setActionMessage(payload.error ?? 'Müvekkil daveti gönderilemedi.');
        return;
      }

      setActionMessage('Müvekkil daveti oluşturuldu.');
      setInviteUrl(payload.inviteUrl ?? null);
      setInviteFullName('');
      setInviteUsername('');
      setInviteTcIdentity('');
      setInviteContactName('');
      setInvitePhone('');
      setInvitePartyType('');
      setInviteEmail('');
      setInviteDays(7);
      await refetch();
    } catch {
      setActionMessage('Müvekkil daveti gönderilirken hata oluştu.');
    } finally {
      setIsSubmittingInvite(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Müvekkil Yönetimi</CardTitle>
              <p className="text-sm text-slate-500">Müvekkil listenizi takip edin, yeni müvekkil daveti oluşturun.</p>
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
              + Müvekkil Ekle (Davet)
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <p className="text-xs text-slate-500">Toplam Müvekkil</p>
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
            placeholder="Müvekkil adına göre ara"
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
            <p className="text-sm text-orange-600">{error instanceof Error ? error.message : 'Müvekkiller alınamadı.'}</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left">
                    <tr>
                      <th className="px-4 py-3">Müvekkil</th>
                      <th className="px-4 py-3">Dosya</th>
                      <th className="px-4 py-3">Durum</th>
                      <th className="px-4 py-3">Son Güncelleme</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClients.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                          Müvekkil bulunamadı.
                        </td>
                      </tr>
                    ) : (
                      filteredClients.map((item) => (
                        <tr key={item.id} className="border-t border-border hover:bg-slate-50/60">
                          <td className="px-4 py-3 font-medium text-slate-900">{item.fullName}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="blue">Toplam: {item.caseCount}</Badge>
                              <Badge variant={item.openCaseCount > 0 ? 'orange' : 'muted'}>Açık: {item.openCaseCount}</Badge>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={item.openCaseCount > 0 ? 'orange' : 'muted'}>
                              {item.openCaseCount > 0 ? 'Aktif Süreçte' : 'Pasif'}
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
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Son Müvekkil Davetleri</p>
                  <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
                    Yenile
                  </Button>
                </div>
                {invites.length === 0 ? (
                  <p className="text-xs text-slate-500">Henüz müvekkil daveti oluşturulmadı.</p>
                ) : (
                  <ul className="space-y-2 text-xs">
                    {invites.slice(0, 8).map((invite) => (
                      <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                        <div>
                          <p className="font-medium text-slate-700">{invite.fullName ?? invite.email}</p>
                          <p className="text-slate-600">{invite.username ? `@${invite.username} · ${invite.email}` : invite.email}</p>
                          {(invite.tcIdentity || invite.contactName || invite.phone || invite.partyType) ? (
                            <p className="text-slate-500">
                              {invite.tcIdentity ? `TC/VKN: ${invite.tcIdentity}` : null}
                              {invite.tcIdentity && (invite.contactName || invite.phone || invite.partyType) ? ' · ' : null}
                              {invite.contactName ? `İletişim: ${invite.contactName}` : null}
                              {invite.contactName && (invite.phone || invite.partyType) ? ' · ' : null}
                              {invite.phone ? `Tel: ${invite.phone}` : null}
                              {invite.phone && invite.partyType ? ' · ' : null}
                              {invite.partyType
                                ? invite.partyType === 'plaintiff'
                                  ? 'Davacı'
                                  : invite.partyType === 'defendant'
                                    ? 'Davalı'
                                    : 'Danışan'
                                : null}
                            </p>
                          ) : null}
                          <p className="text-slate-500" suppressHydrationWarning>
                            Oluşturma: {formatDateTR(invite.createdAt)} · Son: {formatDateTR(invite.expiresAt)}
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
            </>
          )}
        </CardContent>
      </Card>

      {inviteModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Müvekkil Daveti Oluştur</h3>
            <p className="mt-1 text-sm text-slate-600">Yeni müvekkili davet ederek kayıt akışına yönlendirin.</p>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Ad Soyad</label>
                <Input
                  value={inviteFullName}
                  onChange={(event) => setInviteFullName(event.target.value)}
                  placeholder="Örn. Ayşe Yılmaz"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Kullanıcı Adı (Opsiyonel)</label>
                <Input
                  value={inviteUsername}
                  onChange={(event) => setInviteUsername(event.target.value.toLowerCase())}
                  placeholder="ayseyilmaz"
                />
                {isInviteUsernameProvided && !isInviteUsernameValid ? (
                  <p className="mt-1 text-xs text-orange-600">Sadece a-z, 0-9, . ve _ kullanın; minimum 3 karakter.</p>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">TC / VKN (Opsiyonel)</label>
                  <Input value={inviteTcIdentity} onChange={(event) => setInviteTcIdentity(event.target.value)} placeholder="12345678901" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">İletişim Kişisi (Opsiyonel)</label>
                  <Input value={inviteContactName} onChange={(event) => setInviteContactName(event.target.value)} placeholder="Örn. Mehmet Kaya" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Telefon (Opsiyonel)</label>
                  <Input value={invitePhone} onChange={(event) => setInvitePhone(event.target.value)} placeholder="05xx xxx xx xx" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Taraf Tipi (Opsiyonel)</label>
                  <select
                    value={invitePartyType}
                    onChange={(event) => setInvitePartyType(event.target.value as '' | 'plaintiff' | 'defendant' | 'consultant')}
                    className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                  >
                    <option value="">Belirtilmedi</option>
                    <option value="plaintiff">Davacı</option>
                    <option value="defendant">Davalı</option>
                    <option value="consultant">Danışan</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">E-Posta</label>
                <Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="ornek@domain.com" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Geçerlilik (Gün)</label>
                <select
                  value={inviteDays}
                  onChange={(event) => setInviteDays(Number(event.target.value))}
                  className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                >
                  <option value={3}>3 gün</option>
                  <option value={7}>7 gün</option>
                  <option value={14}>14 gün</option>
                  <option value={30}>30 gün</option>
                </select>
              </div>
            </div>

            {actionMessage ? <p className="mt-3 text-xs text-slate-600">{actionMessage}</p> : null}
            {inviteUrl ? (
              <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-700">
                Davet bağlantısı: <a href={inviteUrl} className="font-medium underline">{inviteUrl}</a>
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
                disabled={isSubmittingInvite || inviteFullName.trim().length < 3 || inviteEmail.trim().length < 5 || !isInviteUsernameValid}
                onClick={submitClientInvite}
              >
                Davet Oluştur
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
