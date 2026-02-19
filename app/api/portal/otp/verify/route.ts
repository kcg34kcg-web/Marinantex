import { cookies } from 'next/headers';
import { z } from 'zod';
import { verifyOtp } from '@/lib/portal/otp-store';

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  code: z.string().length(6),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());

  if (!parsed.success) {
    return new Response('OTP doğrulama verisi geçersiz.', { status: 400 });
  }

  const isValid = verifyOtp(parsed.data.sessionId, parsed.data.code);

  if (!isValid) {
    return new Response('OTP kodu doğrulanamadı.', { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set('portal_2fa_verified', 'true', {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8,
  });

  return Response.json({ success: true });
}
