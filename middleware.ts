import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database';

type UserRole = Database['public']['Enums']['user_role'];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl) {
  throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_URL');
}

if (!supabaseAnonKey) {
  throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

function isAuthRoute(pathname: string): boolean {
  return pathname.startsWith('/login') || pathname === '/signup';
}

function isPublicRoute(pathname: string): boolean {
  return pathname === '/' || isAuthRoute(pathname) || pathname.startsWith('/auth');
}

function isDashboardRoute(pathname: string): boolean {
  return pathname.startsWith('/dashboard') || pathname.startsWith('/tools') || pathname.startsWith('/cases') || pathname.startsWith('/office');
}

function isPortalRoute(pathname: string): boolean {
  return pathname.startsWith('/portal');
}

function getHomeRouteByRole(role: UserRole): '/dashboard' | '/portal' {
  return role === 'client' ? '/portal' : '/dashboard';
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));

        response = NextResponse.next({
          request,
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isSwitchAccountFlow = request.nextUrl.searchParams.get('switch') === '1';

  if (!user) {
    if (isPublicRoute(pathname)) {
      return response;
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    if (pathname.startsWith('/onboarding')) {
      return response;
    }

    const onboardingUrl = request.nextUrl.clone();
    onboardingUrl.pathname = '/onboarding';
    onboardingUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(onboardingUrl);
  }

  const role = profile.role as UserRole;

  if (isAuthRoute(pathname)) {
    if (isSwitchAccountFlow) {
      return response;
    }

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = getHomeRouteByRole(role);
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  if (isDashboardRoute(pathname) && role === 'client') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = getHomeRouteByRole(role);
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  if (isPortalRoute(pathname) && role !== 'client') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = getHomeRouteByRole(role);
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  if (isPortalRoute(pathname) && pathname !== '/portal/otp') {
    const twoFactorVerified = request.cookies.get('portal_2fa_verified')?.value === 'true';

    if (!twoFactorVerified) {
      const otpUrl = request.nextUrl.clone();
      otpUrl.pathname = '/portal/otp';
      otpUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(otpUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
