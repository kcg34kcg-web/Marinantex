import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Route } from 'next';

export async function requirePortalTwoFactor(nextPath?: string) {
  const cookieStore = await cookies();
  const verified = cookieStore.get('portal_2fa_verified')?.value === 'true';

  if (!verified) {
    const target = nextPath ? `/portal/otp?next=${encodeURIComponent(nextPath)}` : '/portal/otp';
    redirect(target as Route);
  }
}
