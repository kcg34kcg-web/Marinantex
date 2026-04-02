import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { publishOfficeNotification } from '@/lib/office/notifications';
import { createAdminClient } from '@/utils/supabase/admin';
import { logDashboardAudit } from '@/lib/dashboard/audit';
import { resolveInternalUserBureauScope } from '@/lib/dashboard/client-access';

const createBroadcastSchema = z.object({
  title: z.string().min(1).max(180),
  body: z.string().min(1).max(4000),
  targetScope: z.enum(['all', 'lawyer', 'assistant']).default('all'),
  expiresAt: z.string().datetime().optional(),
});

function getBroadcastScopeLabel(scope: 'all' | 'lawyer' | 'assistant') {
  if (scope === 'lawyer') return 'Avukatlar';
  if (scope === 'assistant') return 'Asistanlar';
  return 'Tum Ofis';
}

function getBroadcastThreadTitle(scope: 'all' | 'lawyer' | 'assistant') {
  if (scope === 'lawyer') return 'Ofis Duyurulari · Avukatlar';
  if (scope === 'assistant') return 'Ofis Duyurulari · Asistanlar';
  return 'Ofis Duyurulari · Tum Ofis';
}

async function resolveRecipientIds(input: {
  admin: ReturnType<typeof createAdminClient>;
  bureauProfileIds: string[];
  targetScope: 'all' | 'lawyer' | 'assistant';
}) {
  const roleFilter = input.targetScope === 'all' ? ['lawyer', 'assistant'] : [input.targetScope];
  const recipientsResult = await input.admin
    .from('profiles')
    .select('id')
    .in('id', input.bureauProfileIds)
    .in('role', roleFilter);

  if (recipientsResult.error) {
    return { ok: false as const, error: 'Duyuru alicilari alinamadi.' };
  }

  const recipientIds = (recipientsResult.data ?? []).map((item) => item.id);
  if (recipientIds.length === 0) {
    return { ok: false as const, error: 'Bu hedef kapsamda alici bulunamadi.' };
  }

  return { ok: true as const, recipientIds };
}

async function ensureBroadcastThread(input: {
  admin: ReturnType<typeof createAdminClient>;
  creatorUserId: string;
  bureauProfileIds: string[];
  recipientIds: string[];
  targetScope: 'all' | 'lawyer' | 'assistant';
}) {
  const threadTitle = getBroadcastThreadTitle(input.targetScope);
  const existingResult = await input.admin
    .from('office_threads')
    .select('id')
    .eq('thread_type', 'broadcast')
    .eq('title', threadTitle)
    .eq('is_archived', false)
    .in('created_by', input.bureauProfileIds)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingResult.error) {
    return { ok: false as const, error: 'Duyuru sohbeti okunamadi.' };
  }

  let threadId = existingResult.data?.id ?? null;

  if (!threadId) {
    const createResult = await input.admin
      .from('office_threads')
      .insert({
        title: threadTitle,
        thread_type: 'broadcast',
        target_role: input.targetScope === 'all' ? null : input.targetScope,
        created_by: input.creatorUserId,
        is_archived: false,
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (createResult.error || !createResult.data?.id) {
      return { ok: false as const, error: 'Duyuru sohbeti olusturulamadi.' };
    }

    threadId = createResult.data.id;
  }

  const memberIds = [...new Set([...input.recipientIds, input.creatorUserId])];
  const memberRows = memberIds.map((userId) => ({ thread_id: threadId, user_id: userId }));

  const upsertResult = await input.admin
    .from('office_thread_members')
    .upsert(memberRows, { onConflict: 'thread_id,user_id', ignoreDuplicates: true });

  if (upsertResult.error) {
    return { ok: false as const, error: 'Duyuru sohbet uyeleri eklenemedi.' };
  }

  return { ok: true as const, threadId };
}

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
  const admin = createAdminClient();

  const scope = await resolveInternalUserBureauScope(admin, access.userId);
  if (!scope) {
    return Response.json({ error: 'Büro kapsamı doğrulanamadı.' }, { status: 403 });
  }

  const recipientsResult = await resolveRecipientIds({
    admin,
    bureauProfileIds: scope.bureauProfileIds,
    targetScope: payload.targetScope,
  });

  if (!recipientsResult.ok) {
    return Response.json({ error: recipientsResult.error }, { status: 400 });
  }

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

  const threadResult = await ensureBroadcastThread({
    admin,
    creatorUserId: access.userId,
    bureauProfileIds: scope.bureauProfileIds,
    recipientIds: recipientsResult.recipientIds,
    targetScope: payload.targetScope,
  });

  if (!threadResult.ok) {
    return Response.json({ error: threadResult.error }, { status: 500 });
  }

  const broadcast = insertResponse.data;
  const threadId = threadResult.threadId;
  const now = new Date().toISOString();

  const messageBody = [
    '[Ofis Duyurusu]',
    `Baslik: ${payload.title}`,
    `Kapsam: ${getBroadcastScopeLabel(payload.targetScope)}`,
    '',
    payload.body,
  ].join('\n');

  const messageResult = await admin.from('office_messages').insert({
    thread_id: threadId,
    sender_id: access.userId,
    body: messageBody,
    metadata: {
      origin: 'office_broadcast',
      broadcast_id: broadcast.id,
      target_scope: payload.targetScope,
    },
  });

  if (messageResult.error) {
    return Response.json({ error: 'Duyuru kaydedildi ancak ekip kanalina aktarilamadi.' }, { status: 500 });
  }

  await admin.from('office_threads').update({ last_message_at: now }).eq('id', threadId);

  publishOfficeNotification({
    type: 'risk_communication',
    category: 'messages',
    title: `Ekip duyurusu: ${payload.title}`,
    detail: payload.body.length > 120 ? `${payload.body.slice(0, 117)}...` : payload.body,
    actionUrl: `/office?tab=team&threadId=${threadId}`,
    actionLabel: 'Duyuruyu Gor',
    bureauId: access.bureauId,
    recipientUserIds: recipientsResult.recipientIds,
  });

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'office_broadcast_sent',
    entityType: 'office_broadcast',
    entityId: broadcast.id,
    metadata: {
      targetScope: payload.targetScope,
      title: payload.title,
      threadId,
      recipientCount: recipientsResult.recipientIds.length,
    },
  });

  return Response.json({ broadcast, threadId });
}
