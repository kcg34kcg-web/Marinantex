'use client';

import { useActionState, useEffect, useRef } from 'react';
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

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || 'http://localhost:4000';
const API_TENANT_SLUG = process.env.NEXT_PUBLIC_API_TENANT_SLUG?.trim() || '';

async function bridgeApiSession(input: { email: string; password: string }): Promise<void> {
  if (!API_TENANT_SLUG) return;

  await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      tenantSlug: API_TENANT_SLUG,
    }),
  });
}

export function LoginForm({ nextPath, expectedRole }: LoginFormProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(loginAction, initialState);
  const submittedCredentialsRef = useRef<{ email: string; password: string } | null>(null);
  const redirectedRef = useRef(false);

  useEffect(() => {
    const redirectTo = state.data?.redirectTo;
    if (!state.success || !redirectTo || redirectedRef.current) return;

    let cancelled = false;
    const finalizeLogin = async () => {
      const submitted = submittedCredentialsRef.current;
      if (submitted) {
        try {
          await bridgeApiSession(submitted);
        } catch {
          // Supabase oturumunu bozma: API cookie bridge best-effort calisir.
        }
      }

      if (cancelled) return;
      redirectedRef.current = true;
      router.push(redirectTo as Route);
      router.refresh();
    };

    void finalizeLogin();
    return () => {
      cancelled = true;
    };
  }, [router, state]);

  return (
    <form
      action={formAction}
      className="space-y-3"
      onSubmit={(event) => {
        const formData = new FormData(event.currentTarget);
        const email = String(formData.get('email') ?? '').trim();
        const password = String(formData.get('password') ?? '');
        submittedCredentialsRef.current = email && password ? { email, password } : null;
      }}
    >
      <Input name="email" type="email" placeholder="E-posta" required />
      <Input name="password" type="password" placeholder="Şifre" required minLength={8} />
      <input type="hidden" name="nextPath" value={nextPath ?? ''} />
      <input type="hidden" name="expectedRole" value={expectedRole} />
      {state.error ? <p className="text-sm text-[var(--warning)]">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? 'Giriş yapılıyor...' : 'Giriş Yap'}
      </Button>
    </form>
  );
}
