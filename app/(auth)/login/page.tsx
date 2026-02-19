import { LoginForm } from '@/components/auth/login-form';
import { MagicLinkForm } from '@/components/auth/magic-link-form';
import { Tabs } from '@/components/ui/tabs';
import Link from 'next/link';

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string; error_description?: string; as?: string; switch?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const hasError = Boolean(params.error || params.error_description);
  const selectedRole =
    params.as === 'lawyer' || params.as === 'assistant' || params.as === 'client' ? params.as : null;
  const switchQuery = params.switch === '1' ? '1' : undefined;

  const lawyerHref = params.next
    ? { pathname: '/login/avukat', query: { next: params.next, ...(switchQuery ? { switch: switchQuery } : {}) } }
    : { pathname: '/login/avukat', query: switchQuery ? { switch: switchQuery } : undefined };
  const clientHref = params.next
    ? { pathname: '/login/muvekkil', query: { next: params.next, ...(switchQuery ? { switch: switchQuery } : {}) } }
    : { pathname: '/login/muvekkil', query: switchQuery ? { switch: switchQuery } : undefined };
  const assistantHref = params.next
    ? { pathname: '/login/asistan', query: { next: params.next, ...(switchQuery ? { switch: switchQuery } : {}) } }
    : { pathname: '/login/asistan', query: switchQuery ? { switch: switchQuery } : undefined };

  const roleTitle =
    selectedRole === 'lawyer'
      ? 'Avukat Girişi'
      : selectedRole === 'assistant'
        ? 'Asistan Girişi'
        : selectedRole === 'client'
          ? 'Müvekkil Girişi'
          : 'Giriş Yap';

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <div className="w-full space-y-4 rounded-xl border border-border bg-white p-6">
        <h1 className="text-2xl font-semibold text-slate-900">{roleTitle}</h1>
        <p className="text-sm text-slate-600">Lütfen giriş türünüzü seçin.</p>

        <div className="grid grid-cols-3 gap-2">
          <Link
            href={lawyerHref}
            className={
              selectedRole === 'lawyer'
                ? 'inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90'
                : 'inline-flex h-10 items-center justify-center rounded-md border border-border bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-muted'
            }
          >
            Avukat
          </Link>
          <Link
            href={assistantHref}
            className={
              selectedRole === 'assistant'
                ? 'inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90'
                : 'inline-flex h-10 items-center justify-center rounded-md border border-border bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-muted'
            }
          >
            Asistan
          </Link>
          <Link
            href={clientHref}
            className={
              selectedRole === 'client'
                ? 'inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90'
                : 'inline-flex h-10 items-center justify-center rounded-md border border-border bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-muted'
            }
          >
            Müvekkil
          </Link>
        </div>

        {!selectedRole ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            Devam etmek için önce giriş türünü seçin.
          </p>
        ) : null}

        {hasError ? (
          <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
            {params.error_description ?? 'Giriş doğrulaması başarısız oldu. Lütfen tekrar deneyin.'}
          </div>
        ) : null}

        {selectedRole ? (
          <Tabs
            items={[
              {
                value: 'password',
                label: 'Şifre ile',
                content: <LoginForm nextPath={params.next} expectedRole={selectedRole} />,
              },
              {
                value: 'magic',
                label: 'Magic Link',
                content: <MagicLinkForm nextPath={params.next} expectedRole={selectedRole} />,
              },
            ]}
          />
        ) : null}
      </div>
    </main>
  );
}
