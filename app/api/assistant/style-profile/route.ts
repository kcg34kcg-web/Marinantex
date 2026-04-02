import { getSessionUser } from '@/lib/auth/session';
import { getAssistantStyleProfile, saveAssistantStyleProfile } from '@/lib/assistant/repository';
import { assistantStyleProfileSchema } from '@/lib/validators/assistant';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
  }

  const profile = await getAssistantStyleProfile(user);
  return Response.json({ profile });
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = assistantStyleProfileSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz stil profili verisi.' }, { status: 400 });
  }

  const profile = await saveAssistantStyleProfile(user, parsed.data);
  return Response.json({ profile });
}
