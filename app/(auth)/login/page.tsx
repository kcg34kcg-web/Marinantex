import { LoginForm } from '@/components/auth/login-form';
import { MagicLinkForm } from '@/components/auth/magic-link-form';
import { Tabs } from '@/components/ui/tabs';
import { Logo } from '@/components/brand/Logo';
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
      <div className="w-full space-y-4 rounded-[var(--radius-md)] border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_4%)] p-6 shadow-[var(--shadow-elev-2)] backdrop-blur-[var(--blur-heavy)]">
        <div className="flex justify-center">
          <Logo width={176} height={54} className="h-10 w-auto" priority />
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-[var(--main-text,var(--text))]">{roleTitle}</h1>
        <p className="text-sm text-[var(--main-muted,var(--secondary))]">Lütfen giriş türünüzü seçin.</p>

        <div className="grid grid-cols-3 gap-2">
          <Link
            href={lawyerHref}
            className={
              selectedRole === 'lawyer'
                ? 'inline-flex h-10 items-center justify-center rounded-[var(--radius-xs)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary),white_8%),var(--primary))] px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-elev-0)] transition-colors'
                : 'inline-flex h-10 items-center justify-center rounded-[var(--radius-xs)] border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_4%)] px-4 py-2 text-sm font-medium text-[var(--main-muted,var(--secondary))] transition-colors hover:bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),var(--primary)_8%)] hover:text-[var(--main-text,var(--text))]'
            }
          >
            Avukat
          </Link>
          <Link
            href={assistantHref}
            className={
              selectedRole === 'assistant'
                ? 'inline-flex h-10 items-center justify-center rounded-[var(--radius-xs)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary),white_8%),var(--primary))] px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-elev-0)] transition-colors'
                : 'inline-flex h-10 items-center justify-center rounded-[var(--radius-xs)] border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_4%)] px-4 py-2 text-sm font-medium text-[var(--main-muted,var(--secondary))] transition-colors hover:bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),var(--primary)_8%)] hover:text-[var(--main-text,var(--text))]'
            }
          >
            Asistan
          </Link>
          <Link
            href={clientHref}
            className={
              selectedRole === 'client'
                ? 'inline-flex h-10 items-center justify-center rounded-[var(--radius-xs)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary),white_8%),var(--primary))] px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-elev-0)] transition-colors'
                : 'inline-flex h-10 items-center justify-center rounded-[var(--radius-xs)] border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_4%)] px-4 py-2 text-sm font-medium text-[var(--main-muted,var(--secondary))] transition-colors hover:bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),var(--primary)_8%)] hover:text-[var(--main-text,var(--text))]'
            }
          >
            Müvekkil
          </Link>
        </div>

        {!selectedRole ? (
          <p className="rounded-[var(--radius-xs)] border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),transparent_8%)] p-3 text-sm text-[var(--main-muted,var(--secondary))]">
            Devam etmek için önce giriş türünü seçin.
          </p>
        ) : null}

        {hasError ? (
          <div className="rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--warning),white_62%)] bg-[color-mix(in_srgb,var(--warning),white_90%)] p-3 text-sm text-[var(--warning)]">
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
