'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const USERNAME_PATTERN = /^[a-z0-9._]+$/;

type ProfilePayload = {
  profile: {
    id: string;
    fullName: string;
    username: string | null;
    email: string | null;
    role: 'lawyer' | 'assistant' | 'client';
  };
};

export default function ProfilePage() {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const normalizedUsername = username.trim().toLowerCase();
  const usernameProvided = normalizedUsername.length > 0;
  const usernameValid =
    !usernameProvided || (normalizedUsername.length >= 3 && USERNAME_PATTERN.test(normalizedUsername));

  useEffect(() => {
    async function loadProfile() {
      setIsLoading(true);
      setMessage(null);

      try {
        const response = await fetch('/api/dashboard/profile', { cache: 'no-store' });
        const payload = (await response.json()) as ProfilePayload & { error?: string };

        if (!response.ok || !payload.profile) {
          setMessage(payload.error ?? 'Profil bilgisi yüklenemedi.');
          setIsLoading(false);
          return;
        }

        setFullName(payload.profile.fullName ?? '');
        setUsername(payload.profile.username ?? '');
        setEmail(payload.profile.email ?? '');
        setRole(payload.profile.role ?? '');
      } catch {
        setMessage('Profil bilgisi yüklenemedi.');
      } finally {
        setIsLoading(false);
      }
    }

    loadProfile().catch(() => {
      setMessage('Profil bilgisi yüklenemedi.');
      setIsLoading(false);
    });
  }, []);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (fullName.trim().length < 2) {
      setMessage('Ad soyad en az 2 karakter olmalı.');
      return;
    }

    if (!usernameValid) {
      setMessage('Kullanıcı adı sadece a-z, 0-9, . ve _ içerebilir; minimum 3 karakter olmalıdır.');
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch('/api/dashboard/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          username: normalizedUsername || undefined,
        }),
      });

      const payload = (await response.json()) as ProfilePayload & { error?: string };

      if (!response.ok || !payload.profile) {
        setMessage(payload.error ?? 'Profil güncellenemedi.');
        return;
      }

      setFullName(payload.profile.fullName ?? fullName.trim());
      setUsername(payload.profile.username ?? '');
      setEmail(payload.profile.email ?? email);
      setRole(payload.profile.role ?? role);
      setMessage('Profil başarıyla güncellendi.');
    } catch {
      setMessage('Profil güncellenemedi.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="space-y-4">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Profil Ayarları</CardTitle>
          <p className="text-sm text-slate-500">Ad soyad ve kullanıcı adı bilgilerinizi güncelleyin.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-600">Yükleniyor...</p>
          ) : (
            <form onSubmit={saveProfile} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Ad Soyad</label>
                <Input value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={2} maxLength={120} required />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Kullanıcı Adı</label>
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value.toLowerCase())}
                  placeholder="ornek.kullanici"
                  minLength={3}
                  maxLength={40}
                />
                <p className="mt-1 text-xs text-slate-500">Opsiyonel. Sadece a-z, 0-9, . ve _ kullanın.</p>
                {usernameProvided && !usernameValid ? (
                  <p className="mt-1 text-xs text-orange-600">Kullanıcı adı formatı geçersiz.</p>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">E-Posta</label>
                <Input value={email} readOnly />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Rol</label>
                <Input
                  value={role === 'lawyer' ? 'Avukat' : role === 'assistant' ? 'Asistan' : role === 'client' ? 'Müvekkil' : '-'}
                  readOnly
                />
              </div>

              {message ? <p className="text-sm text-slate-700">{message}</p> : null}

              <div className="flex justify-end">
                <Button type="submit" disabled={isSubmitting || !usernameValid}>
                  {isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
