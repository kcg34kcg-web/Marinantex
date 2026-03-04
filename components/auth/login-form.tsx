'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { loginAction } from '@/app/(auth)/actions';
import type { ActionResult } from '@/types';

interface LoginFormProps {
  nextPath?: string;
  expectedRole: 'lawyer' | 'assistant' | 'client';
}

const initialState: ActionResult<{ redirectTo: string }> = {
  success: false,
};

export function LoginForm({ nextPath, expectedRole }: LoginFormProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  useEffect(() => {
    if (state.success && state.data?.redirectTo) {
      router.push(state.data.redirectTo as Route);
      router.refresh();
    }
  }, [router, state]);

  return (
    <form action={formAction} className="space-y-3">
      <Input name="email" type="email" placeholder="E-posta" required />
      <Input name="password" type="password" placeholder="Şifre" required minLength={8} />
      <input type="hidden" name="nextPath" value={nextPath ?? ''} />
      <input type="hidden" name="expectedRole" value={expectedRole} />
      {state.error ? <p className="text-sm text-orange-600">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? 'Giriş yapılıyor...' : 'Giriş Yap'}
      </Button>
    </form>
  );
}
