import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';

const acceptSchema = z.object({
  caseId: z.string().uuid(),
  estimatedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accepted: z.boolean(),
});

export async function POST(request: Request) {
  try {
    const parsed = acceptSchema.safeParse(await request.json());

    if (!parsed.success || !parsed.data.accepted) {
      return new Response('Doğrulama kabulü zorunludur.', { status: 400 });
    }

    const supabase = await createClient();
    const { error } = await supabase.from('limitation_acceptances').insert({
      case_id: parsed.data.caseId,
      estimated_date: parsed.data.estimatedDate,
      accepted_by_user: true,
    });

    if (error) {
      return new Response('Kabul kaydı oluşturulamadı.', { status: 500 });
    }

    return Response.json({ success: true });
  } catch {
    return new Response('Kabul servisi hatası.', { status: 500 });
  }
}
