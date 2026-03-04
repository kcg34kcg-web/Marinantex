'use client';

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createClient as createSupabaseClient } from '@/utils/supabase/client';

interface MagicLinkFormProps {
  nextPath?: string;
  expectedRole: 'lawyer' | 'assistant' | 'client';
}

function isSafeNext(nextPath: string | undefined): nextPath is string {
  if (!nextPath) {
    return false;
  }

  return nextPath.startsWith('/') && !nextPath.startsWith('//') && !nextPath.startsWith('/api');
}

export function MagicLinkForm({ nextPath, expectedRole }: MagicLinkFormProps) {
  const [email, setEmail] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const safeNext = useMemo(() => (isSafeNext(nextPath) ? nextPath : ''), [nextPath]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setIsPending(true);

    try {
      const supabase = createSupabaseClient();
      const origin = window.location.origin;

      const redirectUrl = new URL('/auth/callback', origin);
      if (safeNext) {
        redirectUrl.searchParams.set('next', safeNext);
      }
      redirectUrl.searchParams.set('as', expectedRole);

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectUrl.toString(),
          shouldCreateUser: true,
        },
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage('Giriş bağlantısı e-posta adresinize gönderildi. Lütfen e-postanızdan onaylayın.');
    } catch {
      setMessage('Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input
        name="email"
        type="email"
        placeholder="E-posta"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? 'Bağlantı gönderiliyor...' : 'Magic Link Gönder'}
      </Button>
      <p className="text-xs text-slate-500">
        Not: İlk girişte sizden ad-soyad ve rol seçimi istenebilir.
      </p>
    </form>
  );
}
