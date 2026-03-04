import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const createMessageSchema = z.object({
  body: z.string().min(1).max(5000),
  caseId: z.string().uuid().optional(),
  sendEmailAlso: z.boolean().default(false),
  subject: z.string().trim().max(240).optional(),
});

async function resolveClientEmail(admin: ReturnType<typeof createAdminClient>, clientId: string): Promise<string | null> {
  const result = await admin
    .from('clients')
    .select('email')
    .eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle<{ email: string | null }>();

  if (result.error || !result.data) {
    return null;
  }

  return result.data.email;
}

async function attemptEmailDelivery(input: {
  to: string;
  subject: string;
  body: string;
  messageId: string;
  clientId: string;
}) {
  const webhook = process.env.CLIENT_EMAIL_WEBHOOK_URL?.trim();

  if (!webhook) {
    return {
      ok: false,
      reason: 'E-posta kanali tanimli degil (CLIENT_EMAIL_WEBHOOK_URL yok).',
    } as const;
  }

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: input.to,
        subject: input.subject,
        body: input.body,
        messageId: input.messageId,
        clientId: input.clientId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        ok: false,
        reason: errorText.slice(0, 240) || 'E-posta servisi hata dondurdu.',
      } as const;
    }

    return { ok: true as const };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'E-posta istegi basarisiz oldu.',
    } as const;
  }
}

function computeMessageStatus(deliveryRows: Array<{ status: 'pending' | 'sent' | 'failed' }>): 'pending' | 'sent' | 'failed' {
  if (deliveryRows.some((row) => row.status === 'failed')) {
    return 'failed';
  }
  if (deliveryRows.length > 0 && deliveryRows.every((row) => row.status === 'sent')) {
    return 'sent';
  }
  return 'pending';
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const { id: clientId } = await context.params;
  const admin = createAdminClient();

  const clientCheck = await admin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle();

  if (clientCheck.error || !clientCheck.data) {
    return Response.json({ error: 'Müvekkil bulunamadi.' }, { status: 404 });
  }

  const messagesResult = await admin
    .from('messages')
    .select('id, public_ref_code, body, status, case_id, sender_user_id, created_at, updated_at')
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);

  if (messagesResult.error) {
    return Response.json({ error: 'Mesaj geçmisi alinamadi.' }, { status: 500 });
  }

  const messages = messagesResult.data ?? [];
  const messageIds = messages.map((item) => item.id);

  const deliveriesResult = messageIds.length
    ? await admin
        .from('message_deliveries')
        .select('id, message_id, channel, status, attempts, error_message, delivered_at, last_attempt_at, created_at')
        .in('message_id', messageIds)
    : { data: [], error: null };

  if (deliveriesResult.error) {
    return Response.json({ error: 'Mesaj teslim kayitlari alinamadi.' }, { status: 500 });
  }

  const deliveriesByMessageId = new Map<string, Array<{
    id: string;
    channel: 'in_app' | 'email' | 'whatsapp';
    status: 'pending' | 'sent' | 'failed';
    attempts: number;
    error_message: string | null;
    delivered_at: string | null;
    last_attempt_at: string | null;
    created_at: string;
  }>>();

  (deliveriesResult.data ?? []).forEach((row) => {
    const current = deliveriesByMessageId.get(row.message_id) ?? [];
    current.push(row);
    deliveriesByMessageId.set(row.message_id, current);
  });

  return Response.json({
    messages: messages.map((message) => {
      const deliveries = deliveriesByMessageId.get(message.id) ?? [];
      const derivedStatus = computeMessageStatus(deliveries.map((item) => ({ status: item.status })));
      return {
        id: message.id,
        publicRefCode: message.public_ref_code,
        body: message.body,
        caseId: message.case_id,
        senderUserId: message.sender_user_id,
        status: derivedStatus,
        createdAt: message.created_at,
        updatedAt: message.updated_at,
        deliveries: deliveries.map((item) => ({
          id: item.id,
          channel: item.channel,
          status: item.status,
          attempts: item.attempts,
          errorMessage: item.error_message,
          deliveredAt: item.delivered_at,
          lastAttemptAt: item.last_attempt_at,
          createdAt: item.created_at,
        })),
      };
    }),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = createMessageSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz mesaj verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const { id: clientId } = await context.params;
  const admin = createAdminClient();

  const clientEmail = await resolveClientEmail(admin, clientId);

  const messageInsert = await admin
    .from('messages')
    .insert({
      client_id: clientId,
      case_id: payload.caseId ?? null,
      sender_user_id: access.userId,
      message_type: 'direct',
      body: payload.body,
      metadata: {
        sendEmailAlso: payload.sendEmailAlso,
      },
      status: payload.sendEmailAlso ? 'pending' : 'sent',
    })
    .select('id, public_ref_code, created_at, status, case_id')
    .single();

  if (messageInsert.error || !messageInsert.data) {
    return Response.json({ error: 'Mesaj olusturulamadi.' }, { status: 500 });
  }

  const message = messageInsert.data;

  await admin
    .from('message_deliveries')
    .insert({
      message_id: message.id,
      channel: 'in_app',
      status: 'sent',
      attempts: 1,
      delivered_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
    });

  let emailDeliveryStatus: 'pending' | 'sent' | 'failed' = 'pending';
  let emailDeliveryError: string | null = null;

  if (payload.sendEmailAlso) {
    if (!clientEmail) {
      emailDeliveryStatus = 'failed';
      emailDeliveryError = 'Müvekkil e-posta adresi bulunamadi.';
    } else {
      const emailResult = await attemptEmailDelivery({
        to: clientEmail,
        subject: payload.subject?.trim() || 'Ofis Mesaji',
        body: payload.body,
        messageId: message.id,
        clientId,
      });

      if (!emailResult.ok) {
        emailDeliveryStatus = 'failed';
        emailDeliveryError = emailResult.reason;
      } else {
        emailDeliveryStatus = 'sent';
      }
    }

    await admin.from('message_deliveries').insert({
      message_id: message.id,
      channel: 'email',
      status: emailDeliveryStatus,
      attempts: 1,
      error_message: emailDeliveryError,
      delivered_at: emailDeliveryStatus === 'sent' ? new Date().toISOString() : null,
      last_attempt_at: new Date().toISOString(),
    });

    await admin
      .from('messages')
      .update({
        status: emailDeliveryStatus === 'failed' ? 'failed' : 'sent',
        updated_at: new Date().toISOString(),
      })
      .eq('id', message.id);
  }

  if (payload.caseId) {
    await admin.from('case_timeline_events').insert({
      case_id: payload.caseId,
      event_type: 'message_sent',
      title: 'Müvekkile mesaj gönderildi',
      description: payload.body.length > 220 ? `${payload.body.slice(0, 217)}...` : payload.body,
      metadata: {
        messageId: message.id,
        sendEmailAlso: payload.sendEmailAlso,
        emailStatus: payload.sendEmailAlso ? emailDeliveryStatus : null,
      },
      created_by: access.userId,
    });
  }

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'client_message_sent',
    entityType: 'message',
    entityId: message.id,
    metadata: {
      clientId,
      caseId: payload.caseId ?? null,
      sendEmailAlso: payload.sendEmailAlso,
      emailStatus: payload.sendEmailAlso ? emailDeliveryStatus : null,
    },
  });

  return Response.json({
    message: {
      id: message.id,
      publicRefCode: message.public_ref_code,
      status: payload.sendEmailAlso ? (emailDeliveryStatus === 'failed' ? 'failed' : 'sent') : 'sent',
      createdAt: message.created_at,
      caseId: message.case_id,
      emailStatus: payload.sendEmailAlso ? emailDeliveryStatus : null,
      emailError: emailDeliveryError,
    },
  });
}

