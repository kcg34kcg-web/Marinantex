import { z } from 'zod';
import { issueOtp } from '@/lib/portal/otp-store';

const bodySchema = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());

  if (!parsed.success) {
    return new Response('Geçersiz e-posta.', { status: 400 });
  }

  const issued = issueOtp(parsed.data.email);

  return Response.json({
    sessionId: issued.sessionId,
    // Demo visibility. Production: deliver via SMS provider and never return code.
    demoOtpCode: issued.code,
  });
}
