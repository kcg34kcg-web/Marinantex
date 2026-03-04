import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { createClient } from '@/utils/supabase/server';

const requestSchema = z.object({
  thread_id: z.string().uuid(),
  message_id: z.string().uuid(),
  reaction: z.enum(['like', 'dislike']),
  reason_code: z.string().trim().min(1).max(64).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((issue) => issue.message).join(' ') },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  let context;
  try {
    context = await resolveBureauContext(supabase);
  } catch {
    return NextResponse.json({ error: 'Oturum bulunamadi.' }, { status: 401 });
  }
  if (!context.bureauId) {
    return NextResponse.json({ error: 'Buro baglami bulunamadi.' }, { status: 401 });
  }

  const { userId, bureauId } = context;
  const { data: thread, error: threadError } = await supabase
    .from('ai_threads')
    .select('id')
    .eq('id', parsed.data.thread_id)
    .eq('user_id', userId)
    .eq('bureau_id', bureauId)
    .maybeSingle();

  if (threadError) {
    return NextResponse.json({ error: 'Thread dogrulanamadi.' }, { status: 503 });
  }
  if (!thread) {
    return NextResponse.json({ error: 'Thread bulunamadi veya erisim yetkiniz yok.' }, { status: 404 });
  }

  const { data: message, error: messageError } = await supabase
    .from('ai_messages')
    .select('id, role, bureau_id')
    .eq('id', parsed.data.message_id)
    .eq('thread_id', parsed.data.thread_id)
    .maybeSingle();

  if (messageError) {
    return NextResponse.json({ error: 'Mesaj dogrulanamadi.' }, { status: 503 });
  }
  if (!message || message.bureau_id !== bureauId) {
    return NextResponse.json({ error: 'Mesaj bulunamadi.' }, { status: 404 });
  }
  if (message.role !== 'assistant') {
    return NextResponse.json({ error: 'Sadece AI mesajlari icin geri bildirim alinabilir.' }, { status: 400 });
  }

  const reasonCode = parsed.data.reaction === 'dislike'
    ? (parsed.data.reason_code ?? null)
    : null;

  const { error: upsertError } = await supabase
    .from('ai_message_feedback')
    .upsert(
      {
        bureau_id: bureauId,
        user_id: userId,
        thread_id: parsed.data.thread_id,
        message_id: parsed.data.message_id,
        reaction: parsed.data.reaction,
        reason_code: reasonCode,
        metadata: {
          source: 'hukuk_ai_chat',
          ...(parsed.data.metadata ?? {}),
        },
      },
      { onConflict: 'user_id,message_id' },
    );

  if (upsertError) {
    return NextResponse.json({ error: 'Geri bildirim kaydedilemedi.' }, { status: 503 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
