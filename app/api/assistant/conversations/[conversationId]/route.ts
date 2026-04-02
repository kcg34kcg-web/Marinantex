import { getSessionUser } from '@/lib/auth/session';
import { getConversationById, getConversationMessages } from '@/lib/assistant/repository';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ conversationId: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
  }

  const { conversationId } = await params;
  const conversation = await getConversationById(user, conversationId);
  if (!conversation) {
    return Response.json({ error: 'Konuşma bulunamadı.' }, { status: 404 });
  }

  const messages = await getConversationMessages(user, conversationId);
  return Response.json({
    conversation,
    messages,
  });
}
