'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { signupAction } from '@/app/(auth)/actions';
import type { ActionResult } from '@/types';

const initialState: ActionResult<{ redirectTo: string }> = {
  success: false,
};

const USERNAME_PATTERN = /^[a-z0-9._]+$/;

interface SignupFormProps {
  inviteToken: string;
  prefilledEmail?: string;
  prefilledFullName?: string;
  prefilledUsername?: string;
}

export function SignupForm({ inviteToken, prefilledEmail, prefilledFullName, prefilledUsername }: SignupFormProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(signupAction, initialState);

  const normalizedPrefilledUsername = (prefilledUsername ?? '').trim().toLowerCase();
  const hasPrefilledUsername = normalizedPrefilledUsername.length > 0;

  useEffect(() => {
    if (state.success && state.data?.redirectTo) {
      router.push(state.data.redirectTo as Route);
      router.refresh();
    }
  }, [router, state]);

  return (
    <form action={formAction} className="space-y-3">
      <Input
        name="fullName"
        placeholder="Ad Soyad"
        required
        minLength={2}
        maxLength={120}
        defaultValue={prefilledFullName ?? ''}
      />
      <Input
        name="email"
        type="email"
        placeholder="E-posta"
        required
        defaultValue={prefilledEmail ?? ''}
        readOnly={Boolean(prefilledEmail)}
      />
      {prefilledEmail ? <p className="text-xs text-slate-500">Davet e-postası otomatik dolduruldu.</p> : null}
      <Input
        name="username"
        placeholder="Kullanıcı adı (opsiyonel)"
        minLength={3}
        maxLength={40}
        pattern={USERNAME_PATTERN.source}
        defaultValue={normalizedPrefilledUsername}
        readOnly={hasPrefilledUsername}
      />
      {hasPrefilledUsername ? <p className="text-xs text-slate-500">Davet kullanıcı adı otomatik dolduruldu.</p> : null}
      <Input name="password" type="password" placeholder="Şifre" required minLength={8} />
      <input type="hidden" name="inviteToken" value={inviteToken} />

      {state.error ? <p className="text-sm text-orange-600">{state.error}</p> : null}

      <Button type="submit" variant="accent" className="w-full" disabled={isPending}>
        {isPending ? 'Kayıt oluşturuluyor...' : 'Kayıt Ol'}
      </Button>
    </form>
  );
}
