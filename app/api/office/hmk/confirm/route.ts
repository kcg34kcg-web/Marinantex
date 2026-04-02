import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { publishOfficeNotification } from '@/lib/office/notifications';

const bodySchema = z.object({
  caseId: z.string().uuid(),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  estimatedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accepted: z.literal(true),
});

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  if (access.role !== 'lawyer') {
    return Response.json({ error: 'HMK onayı için avukat yetkisi gerekir.' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json({ error: 'Onay verisi geçersiz.' }, { status: 400 });
  }

  const caseCheck = await access.supabase
    .from('cases')
    .select('id')
    .eq('id', parsed.data.caseId)
    .eq('bureau_id', access.bureauId)
    .maybeSingle();

  if (caseCheck.error || !caseCheck.data) {
    return Response.json({ error: 'Dosya ofis kapsaminda bulunamadi.' }, { status: 404 });
  }

  const { error } = await access.supabase.from('limitation_acceptances').insert({
    case_id: parsed.data.caseId,
    estimated_date: parsed.data.estimatedDate,
    accepted_by_user: true,
  });

  if (error) {
    return Response.json({ error: 'Onay kaydı oluşturulamadı.' }, { status: 500 });
  }

  publishOfficeNotification({
    type: 'deadline_confirmed',
    category: 'tasks',
    title: 'HMK süre onayı alındı',
    detail: `Dosya ${parsed.data.caseId} için süre ${parsed.data.estimatedDate} olarak avukat onayı ile kaydedildi.`,
    actionUrl: `/cases/${parsed.data.caseId}/finance`,
    actionLabel: 'Dosyayı Aç',
    bureauId: access.bureauId,
  });

  return Response.json({ success: true });
}
