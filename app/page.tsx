import Link from 'next/link';
import { Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface HomePageProps {
  searchParams: Promise<{ error?: string; error_description?: string; error_code?: string }>;
}

function getFriendlyAuthErrorMessage(error: string | undefined, description: string | undefined): string {
  if (!error && !description) {
    return 'Giriş bağlantınız doğrulanamadı. Lütfen tekrar deneyin.';
  }

  const normalized = (error ?? '').toLowerCase();
  if (normalized.includes('expired')) {
    return 'Giriş bağlantınızın süresi dolmuş. Lütfen yeniden giriş bağlantısı isteyin.';
  }

  if (normalized.includes('access_denied')) {
    return 'Erişim reddedildi. Lütfen tekrar deneyin.';
  }

  return description ?? 'Giriş doğrulaması başarısız oldu. Lütfen tekrar deneyin.';
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const hasAuthError = Boolean(params.error || params.error_description || params.error_code);
  const friendlyMessage = getFriendlyAuthErrorMessage(params.error, params.error_description);

  return (
    <main className="app-glass-shell">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        {hasAuthError ? (
          <Card className="w-full max-w-2xl border-[color-mix(in_srgb,var(--warning),white_62%)] bg-[color-mix(in_srgb,var(--warning),white_90%)] text-left">
            <CardHeader>
              <CardTitle className="text-base text-[var(--warning)]">Giriş doğrulaması tamamlanamadı</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-[color-mix(in_srgb,var(--warning),black_18%)]">
              <p>{friendlyMessage}</p>
              {process.env.NODE_ENV !== 'production' ? (
                <pre className="overflow-auto rounded-md border border-[color-mix(in_srgb,var(--warning),white_64%)] bg-[var(--surface)] p-3 text-xs text-[var(--main-text,var(--text))]">
                  {JSON.stringify(params, null, 2)}
                </pre>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <div className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--primary),white_58%)] bg-[color-mix(in_srgb,var(--primary),white_90%)] px-4 py-2 text-sm text-[var(--primary)] shadow-[var(--shadow-elev-0)]">
          <Scale className="h-4 w-4" />
          Babylexit'e Hoş Geldiniz
        </div>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.02em] text-[var(--main-text,var(--text))] md:text-5xl">
          Hukuk operasyonlarınızı tek panelde yönetin
        </h1>
        <p className="max-w-2xl text-[var(--main-muted,var(--secondary))]">
          Dijital İkiz ve Müvekkil Portalı ile dosya yönetimini hızlandırın, şeffaflığı artırın.
        </p>
        <div className="flex gap-3">
          <Link href="/login?switch=1">
            <Button size="lg">Giriş Yap</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
