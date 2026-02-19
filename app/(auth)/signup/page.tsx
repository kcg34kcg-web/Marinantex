import { SignupForm } from '@/components/auth/signup-form';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { createAdminClient } from '@/utils/supabase/admin';

interface SignupPageProps {
  searchParams: Promise<{ invite?: string }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const inviteToken = params.invite ?? '';

  if (!inviteToken) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
        <div className="w-full space-y-4 rounded-xl border border-border bg-white p-6">
          <h1 className="text-2xl font-semibold text-slate-900">Davet Gerekli</h1>
          <p className="text-sm text-slate-600">
            Kayıt sadece yönetici tarafından oluşturulan davet ile yapılabilir. Lütfen size gönderilen davet linkini kullanın.
          </p>
          <Link href="/login?switch=1">
            <Button className="w-full">Giriş Sayfasına Dön</Button>
          </Link>
        </div>
      </main>
    );
  }

  const adminSupabase = createAdminClient();
  const inviteResult = await adminSupabase
    .from('user_invites')
    .select('id, email, full_name, username, target_role, expires_at, accepted_at')
    .eq('token', inviteToken)
    .single();

  const inviteResultFallback =
    inviteResult.error?.code === '42703'
      ? await adminSupabase
          .from('user_invites')
          .select('id, email, target_role, expires_at, accepted_at')
          .eq('token', inviteToken)
          .single()
      : inviteResult;

  const invite = inviteResultFallback.data;
  const inviteError = inviteResultFallback.error;

  if (inviteError || !invite) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
        <div className="w-full space-y-4 rounded-xl border border-border bg-white p-6">
          <h1 className="text-2xl font-semibold text-slate-900">Geçersiz Davet</h1>
          <p className="text-sm text-slate-600">Davet bulunamadı. Lütfen yeni bir davet bağlantısı isteyin.</p>
          <Link href="/login?switch=1">
            <Button className="w-full">Giriş Sayfasına Dön</Button>
          </Link>
        </div>
      </main>
    );
  }

  const inviteExpired = new Date(invite.expires_at).getTime() < Date.now();
  if (invite.accepted_at || inviteExpired) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
        <div className="w-full space-y-4 rounded-xl border border-border bg-white p-6">
          <h1 className="text-2xl font-semibold text-slate-900">Davet Süresi Dolmuş</h1>
          <p className="text-sm text-slate-600">Bu davet daha önce kullanılmış veya süresi dolmuş.</p>
          <Link href="/login?switch=1">
            <Button className="w-full">Giriş Sayfasına Dön</Button>
          </Link>
        </div>
      </main>
    );
  }

  const inviteRecord = invite as Record<string, unknown>;
  const prefilledEmail = typeof inviteRecord.email === 'string' ? inviteRecord.email : '';
  const prefilledFullName = typeof inviteRecord.full_name === 'string' ? inviteRecord.full_name : '';
  const prefilledUsername = typeof inviteRecord.username === 'string' ? inviteRecord.username : '';

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <div className="w-full space-y-4 rounded-xl border border-border bg-white p-6">
        <h1 className="text-2xl font-semibold text-slate-900">Kayıt Ol</h1>
        <p className="text-sm text-slate-600">Davetli hesabınızı oluşturun.</p>
        <SignupForm
          inviteToken={inviteToken}
          prefilledEmail={prefilledEmail}
          prefilledFullName={prefilledFullName}
          prefilledUsername={prefilledUsername}
        />
      </div>
    </main>
  );
}
