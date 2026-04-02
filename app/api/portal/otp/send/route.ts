import { z } from 'zod';
import { issueOtp } from '@/lib/portal/otp-store';
import { createClient } from '@/utils/supabase/server';

const bodySchema = z.object({
  email: z.string().email().optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());

  if (!parsed.success) {
    return new Response('Geçersiz e-posta.', { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return new Response('Portal oturumu doğrulanamadı.', { status: 401 });
  }

  const profileResult = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profileResult.error || profileResult.data?.role !== 'client') {
    return new Response('Portal 2FA yalnızca müvekkil hesabı içindir.', { status: 403 });
  }

  const sessionEmail = String(user.email ?? '').trim().toLowerCase();
  if (!sessionEmail) {
    return new Response('Kullanıcı e-posta bilgisi doğrulanamadı.', { status: 400 });
  }

  const requestedEmail = parsed.data.email?.trim().toLowerCase();
  if (requestedEmail && requestedEmail !== sessionEmail) {
    return new Response('OTP yalnızca aktif oturum e-postasına gönderilebilir.', { status: 400 });
  }

  const issued = issueOtp(sessionEmail);
  const isDemoMode =
    process.env.PORTAL_OTP_DEMO_MODE === 'true' || process.env.NODE_ENV !== 'production';

  return Response.json(
    isDemoMode
      ? {
          sessionId: issued.sessionId,
          demoOtpCode: issued.code,
        }
      : {
          sessionId: issued.sessionId,
        }
  );
}
