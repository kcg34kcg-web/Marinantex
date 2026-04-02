import { getSessionUser } from '@/lib/auth/session';
import { checkAssistantRateLimit } from '@/lib/assistant/rate-limit';
import { createMemoryItem, deleteMemoryItem, listMemoryItems } from '@/lib/assistant/repository';
import { memoryCreateSchema, memoryDeleteSchema } from '@/lib/validators/assistant';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
  }

  const items = await listMemoryItems(user);
  return Response.json({ items });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
  }

  const rate = checkAssistantRateLimit({
    key: `assistant-memory-write:${user.id}`,
    limit: 40,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return Response.json({ error: 'Çok sık hafıza kaydı denemesi yapıldı.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = memoryCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz hafıza verisi.' }, { status: 400 });
  }

  const created = await createMemoryItem(user, parsed.data);
  return Response.json({ item: created });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = memoryDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Silinecek hafıza kaydı geçersiz.' }, { status: 400 });
  }

  await deleteMemoryItem(user, parsed.data.id);
  return Response.json({ ok: true });
}
