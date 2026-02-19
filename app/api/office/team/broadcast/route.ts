import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { publishOfficeNotification } from '@/lib/office/notifications';

const createBroadcastSchema = z.object({
  title: z.string().min(1).max(180),
  body: z.string().min(1).max(4000),
  targetScope: z.enum(['all', 'lawyer', 'assistant']).default('all'),
  expiresAt: z.string().datetime().optional(),
});

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  if (access.role !== 'lawyer') {
    return Response.json({ error: 'Tüm ofis duyurusu için avukat yetkisi gerekir.' }, { status: 403 });
  }

  const parsed = createBroadcastSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz duyuru verisi.' }, { status: 400 });
  }

  const payload = parsed.data;

  const { data, error } = await access.supabase
    .from('office_broadcasts')
    .insert({
      sender_id: access.userId,
      title: payload.title,
      body: payload.body,
      target_scope: payload.targetScope,
      expires_at: payload.expiresAt ?? null,
    })
    .select('id, sender_id, title, body, target_scope, created_at, expires_at')
    .single();

  if (error || !data) {
    return Response.json({ error: 'Duyuru oluşturulamadı.' }, { status: 500 });
  }

  publishOfficeNotification({
    type: 'risk_communication',
    category: 'messages',
    title: `Ekip duyurusu: ${payload.title}`,
    detail: payload.body.length > 120 ? `${payload.body.slice(0, 117)}...` : payload.body,
    actionUrl: '/office',
    actionLabel: 'Duyuruyu Gör',
  });

  return Response.json({ broadcast: data });
}
