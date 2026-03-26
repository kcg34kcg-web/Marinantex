'use client';

import { useCallback, useEffect, useState } from 'react';

type BootstrapState = 'loading' | 'ready' | 'error';

export function MailWorkspaceFrame({ workspaceUrl }: { workspaceUrl: string }) {
  const [state, setState] = useState<BootstrapState>('loading');
  const [errorText, setErrorText] = useState<string | null>(null);

  const bootstrapSession = useCallback(async () => {
    setState('loading');
    setErrorText(null);

    try {
      const response = await fetch('/api/mail-workspace/session', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorText(payload?.error ?? 'Mail workspace oturumu baslatilamadi.');
        setState('error');
        return;
      }

      setState('ready');
    } catch {
      setErrorText('Mail workspace oturum servisine ulasilamadi.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void bootstrapSession();
  }, [bootstrapSession]);

  if (state === 'loading') {
    return (
      <div className="flex h-[calc(100dvh-220px)] min-h-[700px] items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-600">
        Mail workspace oturumu hazirlaniyor...
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex h-[calc(100dvh-220px)] min-h-[700px] flex-col items-center justify-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 text-center">
        <p className="text-sm font-medium text-rose-700">{errorText ?? 'Mail workspace acilamadi.'}</p>
        <button
          type="button"
          onClick={() => {
            void bootstrapSession();
          }}
          className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
        >
          Tekrar Dene
        </button>
        <p className="text-xs text-rose-700/90">Gerekirse terminalde `npm run dev` komutunu yeniden calistirin.</p>
      </div>
    );
  }

  return (
    <iframe
      key={workspaceUrl}
      title="Mail Workspace"
      src={workspaceUrl}
      className="h-[calc(100dvh-220px)] min-h-[700px] w-full rounded-xl border-0"
      loading="lazy"
    />
  );
}
