'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type InviteItem = {
  id: string;
  email: string;
  target_role: 'lawyer' | 'assistant' | 'client';
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

export default function InvitesPage() {
  const [email, setEmail] = useState('');
  const [targetRole, setTargetRole] = useState<'lawyer' | 'assistant' | 'client'>('client');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [invites, setInvites] = useState<InviteItem[]>([]);

  async function loadInvites() {
    setIsLoading(true);
    const response = await fetch('/api/admin/invites', { cache: 'no-store' });
    const payload = (await response.json()) as { invites?: InviteItem[]; error?: string };

    if (!response.ok) {
      setMessage(payload.error ?? 'Davetler yüklenemedi.');
      setIsLoading(false);
      return;
    }

    setInvites(payload.invites ?? []);
    setIsLoading(false);
  }

  useEffect(() => {
    loadInvites().catch(() => {
      setMessage('Davetler yüklenemedi.');
      setIsLoading(false);
    });
  }, []);

  async function handleCreateInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setInviteUrl(null);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, targetRole, expiresInDays }),
      });

      const payload = (await response.json()) as {
        inviteUrl?: string;
        error?: string;
      };

      if (!response.ok) {
        setMessage(payload.error ?? 'Davet oluşturulamadı.');
        return;
      }

      setInviteUrl(payload.inviteUrl ?? null);
      setMessage('Davet başarıyla oluşturuldu.');
      setEmail('');
      await loadInvites();
    } catch {
      setMessage('Beklenmeyen hata oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyInviteUrl() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setMessage('Davet linki panoya kopyalandı.');
  }

  return (
    <main className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Kullanıcı Davet Et</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateInvite} className="grid gap-3 md:grid-cols-[1fr_180px_120px_auto]">
            <Input
              type="email"
              placeholder="davetli@ornek.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <select
              value={targetRole}
              onChange={(event) => setTargetRole(event.target.value as 'lawyer' | 'assistant' | 'client')}
              className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
            >
              <option value="client">Müvekkil</option>
              <option value="assistant">Asistan</option>
              <option value="lawyer">Avukat</option>
            </select>
            <Input
              type="number"
              min={1}
              max={30}
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(Number(event.target.value) || 7)}
            />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Oluşturuluyor...' : 'Davet Oluştur'}
            </Button>
          </form>

          {inviteUrl ? (
            <div className="mt-3 rounded-md border border-border bg-slate-50 p-3 text-sm">
              <p className="mb-2 font-medium text-slate-800">Davet Linki</p>
              <p className="break-all text-slate-700">{inviteUrl}</p>
              <Button type="button" variant="outline" className="mt-2" onClick={copyInviteUrl}>
                Linki Kopyala
              </Button>
            </div>
          ) : null}

          {message ? <p className="mt-3 text-sm text-slate-700">{message}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Son Davetler</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-600">Yükleniyor...</p>
          ) : invites.length === 0 ? (
            <p className="text-sm text-slate-600">Henüz davet bulunmuyor.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {invites.map((invite) => (
                <li key={invite.id} className="rounded-md border border-border p-3">
                  <p className="font-medium text-slate-800">{invite.email}</p>
                  <p className="text-slate-600">
                    Rol:{' '}
                    {invite.target_role === 'lawyer'
                      ? 'Avukat'
                      : invite.target_role === 'assistant'
                        ? 'Asistan'
                        : 'Müvekkil'}{' '}
                    · Süre Sonu:{' '}
                    {new Date(invite.expires_at).toLocaleString('tr-TR')}
                  </p>
                  <p className="text-xs text-slate-500">
                    Durum: {invite.accepted_at ? 'Kullanıldı' : 'Bekliyor'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
