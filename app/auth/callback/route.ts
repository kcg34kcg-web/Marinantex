import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import type { Database } from '@/types/database';

type UserRole = Database['public']['Enums']['user_role'];

function isSafeRedirect(pathname: string | null): pathname is string {
  if (!pathname) {
    return false;
  }

  return pathname.startsWith('/') && !pathname.startsWith('//') && !pathname.startsWith('/api');
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  if (error) {
    const redirectUrl = new URL('/', url.origin);
    redirectUrl.searchParams.set('error', error);
    if (errorDescription) {
      redirectUrl.searchParams.set('error_description', errorDescription);
    }

    if (process.env.NODE_ENV !== 'production') {
      console.error('[auth/callback] Provider error', { error, errorDescription });
    }

    return NextResponse.redirect(redirectUrl);
  }

  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');
  const expectedRole = url.searchParams.get('as');

  if (!code) {
    const redirectUrl = new URL('/', url.origin);
    redirectUrl.searchParams.set('error', 'missing_code');
    redirectUrl.searchParams.set('error_description', 'Auth callback URL içinde code parametresi bulunamadı.');

    if (process.env.NODE_ENV !== 'production') {
      console.error('[auth/callback] Missing code', { search: url.search });
    }

    return NextResponse.redirect(redirectUrl);
  }

  const supabase = await createClient();

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    const redirectUrl = new URL('/', url.origin);
    redirectUrl.searchParams.set('error', 'exchange_failed');
    redirectUrl.searchParams.set('error_description', exchangeError.message);

    if (process.env.NODE_ENV !== 'production') {
      console.error('[auth/callback] exchangeCodeForSession failed', exchangeError);
    }

    return NextResponse.redirect(redirectUrl);
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    const redirectUrl = new URL('/login', url.origin);
    redirectUrl.searchParams.set('error', 'no_user');
    redirectUrl.searchParams.set('error_description', 'Oturum oluşturuldu ancak kullanıcı okunamadı.');

    if (process.env.NODE_ENV !== 'production') {
      console.error('[auth/callback] getUser failed', userError);
    }

    return NextResponse.redirect(redirectUrl);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[auth/callback] missing profile; redirecting to onboarding', profileError);
    }

    const onboardingUrl = new URL('/onboarding', url.origin);
    if (isSafeRedirect(next)) {
      onboardingUrl.searchParams.set('next', next);
    }
    return NextResponse.redirect(onboardingUrl);
  }

  const role = profile.role as UserRole;

  if (expectedRole && expectedRole !== role) {
    const redirectUrl = new URL('/login', url.origin);
    redirectUrl.searchParams.set('switch', '1');
    if (expectedRole === 'lawyer' || expectedRole === 'assistant' || expectedRole === 'client') {
      redirectUrl.searchParams.set('as', expectedRole);
    }
    redirectUrl.searchParams.set('error', 'role_mismatch');
    redirectUrl.searchParams.set(
      'error_description',
      'Bu hesap seçtiğiniz giriş türü ile eşleşmiyor. Lütfen doğru giriş türünü seçin.'
    );

    return NextResponse.redirect(redirectUrl);
  }

  const defaultDestination = role === 'client' ? '/portal' : '/dashboard';
  const destination = isSafeRedirect(next) ? next : defaultDestination;

  return NextResponse.redirect(new URL(destination, url.origin));
}
