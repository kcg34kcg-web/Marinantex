'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/types';
import { completeOnboardingAction } from '@/app/(auth)/actions';

interface OnboardingFormProps {
  nextPath?: string;
}

const initialState: ActionResult<{ redirectTo: string }> = {
  success: false,
};

export function OnboardingForm({ nextPath }: OnboardingFormProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(completeOnboardingAction, initialState);

  useEffect(() => {
    if (state.success && state.data?.redirectTo) {
      router.push(state.data.redirectTo as Route);
      router.refresh();
    }
  }, [router, state]);

  return (
    <form action={formAction} className="space-y-3">
      <Input name="fullName" placeholder="Ad Soyad" required minLength={2} maxLength={120} />
      <select name="role" className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm" required>
        <option value="">Rol seçin</option>
        <option value="client">Müvekkil</option>
        <option value="assistant">Asistan</option>
        <option value="lawyer">Avukat</option>
      </select>
      <input type="hidden" name="nextPath" value={nextPath ?? ''} />

      {state.error ? <p className="text-sm text-orange-600">{state.error}</p> : null}

      <Button className="w-full" disabled={isPending}>
        {isPending ? 'Kaydediliyor...' : 'Devam Et'}
      </Button>
      <p className="text-xs text-slate-500">
        Bu bilgiler profil kaydınızı oluşturmak için gereklidir. Daha sonra ayarlardan güncelleyebilirsiniz.
      </p>
    </form>
  );
}
