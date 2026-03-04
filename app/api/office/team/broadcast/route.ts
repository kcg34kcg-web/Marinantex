import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { publishOfficeNotification } from '@/lib/office/notifications';
import { createAdminClient } from '@/utils/supabase/admin';
import { logDashboardAudit } from '@/lib/dashboard/audit';

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
    return Response.json({ error: 'Tum ofis duyurusu icin avukat yetkisi gerekir.' }, { status: 403 });
  }

  const parsed = createBroadcastSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Gecersiz duyuru verisi.' }, { status: 400 });
  }

  const payload = parsed.data;

  let insertResponse: {
    data: {
      id: string;
      sender_id: string;
      title: string;
      body: string;
      target_scope: 'all' | 'lawyer' | 'assistant';
      created_at: string;
      expires_at: string | null;
    } | null;
    error: { message?: string } | null;
  } | null = null;
  let lastErrorMessage: string | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await access.supabase
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

    insertResponse = response;
    if (!response.error && response.data) {
      break;
    }

    lastErrorMessage = response.error?.message ?? 'Broadcast insert hatasi';
  }

  if (!insertResponse || insertResponse.error || !insertResponse.data) {
    const admin = createAdminClient();
    await logDashboardAudit(admin, {
      actorUserId: access.userId,
      action: 'office_broadcast_failed',
      entityType: 'office_broadcast',
      entityId: null,
      metadata: {
        targetScope: payload.targetScope,
        reason: lastErrorMessage,
      },
    });

    return Response.json({ error: 'Duyuru olusturulamadi.' }, { status: 500 });
  }

  const data = insertResponse.data;

  publishOfficeNotification({
    type: 'risk_communication',
    category: 'messages',
    title: `Ekip duyurusu: ${payload.title}`,
    detail: payload.body.length > 120 ? `${payload.body.slice(0, 117)}...` : payload.body,
    actionUrl: '/office',
    actionLabel: 'Duyuruyu Gor',
  });

  const admin = createAdminClient();
  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'office_broadcast_sent',
    entityType: 'office_broadcast',
    entityId: data.id,
    metadata: {
      targetScope: payload.targetScope,
      title: payload.title,
    },
  });

  return Response.json({ broadcast: data });
}

