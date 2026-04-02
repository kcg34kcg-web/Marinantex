import { getSessionUser } from '@/lib/auth/session';
import { getAssistantPreference, updateAssistantPreference } from '@/lib/assistant/repository';
import { assistantPreferenceSchema } from '@/lib/validators/assistant';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
  }

  const preference = await getAssistantPreference(user);
  return Response.json({ preference });
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = assistantPreferenceSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz tercih verisi.' }, { status: 400 });
  }

  const updated = await updateAssistantPreference(user, parsed.data);
  return Response.json({ preference: updated });
}
