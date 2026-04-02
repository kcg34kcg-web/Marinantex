import { cookies } from 'next/headers';
import { z } from 'zod';
import { verifyOtp } from '@/lib/portal/otp-store';
import { createClient } from '@/utils/supabase/server';
import { extractRequestIp } from '@/lib/portal/audit';
import { issuePortalSession, setPortalSessionCookies } from '@/lib/portal/session';

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  code: z.string().length(6),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());

  if (!parsed.success) {
    return new Response('OTP doğrulama verisi geçersiz.', { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return new Response('Portal oturumu doğrulanamadı.', { status: 401 });
  }

  const profileResult = await supabase.from('profiles').select('role, bureau_id').eq('id', user.id).maybeSingle();
  if (profileResult.error || profileResult.data?.role !== 'client') {
    return new Response('Portal 2FA yalnızca müvekkil hesabı içindir.', { status: 403 });
  }
  if (!profileResult.data.bureau_id) {
    return new Response('Tenant kapsamı doğrulanamadı.', { status: 403 });
  }

  const email = String(user.email ?? '').trim().toLowerCase();
  if (!email) {
    return new Response('Kullanıcı e-posta bilgisi doğrulanamadı.', { status: 400 });
  }

  const isValid = verifyOtp(parsed.data.sessionId, parsed.data.code, email);

  if (!isValid) {
    return new Response('OTP kodu doğrulanamadı.', { status: 401 });
  }

  const cookieStore = await cookies();
  let issuedSession:
    | {
        sessionId: string;
        deviceId: string;
        accessExpiresAt: string;
        refreshExpiresAt: string;
        persisted: boolean;
      }
    | undefined;

  try {
    const createdSession = await issuePortalSession({
      userId: user.id,
      tenantId: profileResult.data.bureau_id,
      cookieStore,
      ipAddress: extractRequestIp(request),
      userAgent: request.headers.get('user-agent'),
      preferredDeviceName: request.headers.get('x-device-name'),
      twoFactorMethod: 'email_otp',
    });

    setPortalSessionCookies(cookieStore, {
      accessToken: createdSession.accessToken,
      refreshToken: createdSession.refreshToken,
      sessionId: createdSession.sessionId,
      deviceId: createdSession.deviceId,
    });

    issuedSession = {
      sessionId: createdSession.sessionId,
      deviceId: createdSession.deviceId,
      accessExpiresAt: createdSession.accessExpiresAt,
      refreshExpiresAt: createdSession.refreshExpiresAt,
      persisted: createdSession.persisted,
    };
  } catch {
    issuedSession = undefined;
  }

  cookieStore.set('portal_2fa_verified', 'true', {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8,
  });

  return Response.json({
    success: true,
    sessionId: issuedSession?.sessionId ?? null,
    deviceId: issuedSession?.deviceId ?? null,
    accessExpiresAt: issuedSession?.accessExpiresAt ?? null,
    refreshExpiresAt: issuedSession?.refreshExpiresAt ?? null,
    persisted: issuedSession?.persisted ?? false,
  });
}
