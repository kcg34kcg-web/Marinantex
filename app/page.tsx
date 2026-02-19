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
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-6 px-6 text-center">
      {hasAuthError ? (
        <Card className="w-full max-w-2xl border-orange-200 bg-orange-50 text-left">
          <CardHeader>
            <CardTitle className="text-base text-orange-800">Giriş doğrulaması tamamlanamadı</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-orange-900">
            <p>{friendlyMessage}</p>
            {process.env.NODE_ENV !== 'production' ? (
              <pre className="overflow-auto rounded-md border border-orange-200 bg-white p-3 text-xs text-slate-700">
                {JSON.stringify(params, null, 2)}
              </pre>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-sm text-blue-700">
        <Scale className="h-4 w-4" />
        Babylexit'e Hoş Geldiniz
      </div>
      <h1 className="text-4xl font-bold tracking-tight text-slate-900">Hukuk operasyonlarınızı tek panelde yönetin</h1>
      <p className="max-w-2xl text-slate-600">
        Dijital İkiz ve Müvekkil Portalı ile dosya yönetimini hızlandırın, şeffaflığı artırın.
      </p>
      <div className="flex gap-3">
        <Link href="/login?switch=1">
          <Button>Giriş Yap</Button>
        </Link>
      </div>
    </main>
  );
}
