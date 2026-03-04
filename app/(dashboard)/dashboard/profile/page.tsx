'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AppearanceSettingsPanel } from '@/components/settings/appearance-settings-panel';

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
          setMessage(payload.error ?? 'Profil bilgisi yuklenemedi.');
          setIsLoading(false);
          return;
        }

        setFullName(payload.profile.fullName ?? '');
        setUsername(payload.profile.username ?? '');
        setEmail(payload.profile.email ?? '');
        setRole(payload.profile.role ?? '');
      } catch {
        setMessage('Profil bilgisi yuklenemedi.');
      } finally {
        setIsLoading(false);
      }
    }

    loadProfile().catch(() => {
      setMessage('Profil bilgisi yuklenemedi.');
      setIsLoading(false);
    });
  }, []);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (fullName.trim().length < 2) {
      setMessage('Ad soyad en az 2 karakter olmali.');
      return;
    }

    if (!usernameValid) {
      setMessage('Kullanici adi sadece a-z, 0-9, . ve _ icerebilir; minimum 3 karakter olmalidir.');
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
        setMessage(payload.error ?? 'Profil guncellenemedi.');
        return;
      }

      setFullName(payload.profile.fullName ?? fullName.trim());
      setUsername(payload.profile.username ?? '');
      setEmail(payload.profile.email ?? email);
      setRole(payload.profile.role ?? role);
      setMessage('Profil basariyla guncellendi.');
    } catch {
      setMessage('Profil guncellenemedi.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="space-y-4">
      <Card className="border-[var(--border)] shadow-sm">
        <CardHeader>
          <CardTitle>Profil Ayarlari</CardTitle>
          <p className="text-sm text-[var(--secondary)]">Ad soyad ve kullanici adi bilgilerinizi guncelleyin.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-[var(--secondary)]">Yukleniyor...</p>
          ) : (
            <form onSubmit={saveProfile} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--secondary)]">
                  Ad Soyad
                </label>
                <Input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  minLength={2}
                  maxLength={120}
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--secondary)]">
                  Kullanici Adi
                </label>
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value.toLowerCase())}
                  placeholder="ornek.kullanici"
                  minLength={3}
                  maxLength={40}
                />
                <p className="mt-1 text-xs text-[var(--secondary)]">
                  Opsiyonel. Sadece a-z, 0-9, . ve _ kullanin.
                </p>
                {usernameProvided && !usernameValid ? (
                  <p className="mt-1 text-xs text-[var(--warning)]">Kullanici adi formati gecersiz.</p>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--secondary)]">
                  E-Posta
                </label>
                <Input value={email} readOnly />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--secondary)]">
                  Rol
                </label>
                <Input
                  value={role === 'lawyer' ? 'Avukat' : role === 'assistant' ? 'Asistan' : role === 'client' ? 'Muvekkil' : '-'}
                  readOnly
                />
              </div>

              {message ? <p className="text-sm text-[var(--secondary)]">{message}</p> : null}

              <div className="flex justify-end">
                <Button type="submit" disabled={isSubmitting || !usernameValid}>
                  {isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <AppearanceSettingsPanel />
    </main>
  );
}
