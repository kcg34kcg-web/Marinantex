import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { createConversation, listAuditLogs, listConversations, listQuickActions } from '@/lib/assistant/repository';

export const runtime = 'nodejs';

const createConversationSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  isTemporary: z.boolean().optional().default(false),
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
  }

  const [conversations, quickActions, auditLogs] = await Promise.all([
    listConversations(user),
    listQuickActions(),
    listAuditLogs(user),
  ]);

  return Response.json({
    conversations,
    quickActions,
    auditLogs,
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createConversationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz konuşma isteği.' }, { status: 400 });
  }

  const conversation = await createConversation(
    user,
    parsed.data.title?.trim() || 'Yeni sohbet',
    parsed.data.isTemporary,
  );

  return Response.json({ conversation });
}
