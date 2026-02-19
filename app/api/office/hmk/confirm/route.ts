import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';
import { publishOfficeNotification } from '@/lib/office/notifications';

const bodySchema = z.object({
  caseId: z.string().uuid(),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  estimatedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accepted: z.literal(true),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());

  if (!parsed.success) {
    return new Response('Onay verisi geçersiz.', { status: 400 });
  }

  const supabase = await createClient();

  const { error } = await supabase.from('limitation_acceptances').insert({
    case_id: parsed.data.caseId,
    estimated_date: parsed.data.estimatedDate,
    accepted_by_user: true,
  });

  if (error) {
    return new Response('Onay kaydı oluşturulamadı.', { status: 500 });
  }

  publishOfficeNotification({
    type: 'deadline_confirmed',
    category: 'tasks',
    title: 'HMK süre onayı alındı',
    detail: `Dosya ${parsed.data.caseId} için süre ${parsed.data.estimatedDate} olarak avukat onayı ile kaydedildi.`,
    actionUrl: `/cases/${parsed.data.caseId}/finance`,
    actionLabel: 'Dosyayı Aç',
  });

  return Response.json({ success: true });
}
