import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { OnboardingForm } from '@/components/auth/onboarding-form';

interface OnboardingPageProps {
  searchParams: Promise<{ next?: string }>;
}

function isSafeRedirect(pathname: string | undefined): pathname is string {
  if (!pathname) {
    return false;
  }

  return pathname.startsWith('/') && !pathname.startsWith('//') && !pathname.startsWith('/api');
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const params = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent('/onboarding')}`);
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();

  if (profile?.role) {
    const destination = profile.role === 'client' ? '/portal/otp?next=%2Fportal' : '/dashboard';
    redirect(destination);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <div className="w-full space-y-4 rounded-xl border border-border bg-white p-6">
        <h1 className="text-2xl font-semibold text-slate-900">Profilinizi Tamamlayın</h1>
        <p className="text-sm text-slate-600">Hesabınızı kullanabilmek için birkaç bilgiye ihtiyacımız var.</p>
        <OnboardingForm nextPath={isSafeRedirect(params.next) ? params.next : undefined} />
      </div>
    </main>
  );
}
