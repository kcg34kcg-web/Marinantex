import { z } from 'zod';
import { detectRiskySentiment } from '@/lib/portal/sentiment';
import { publishOfficeNotification } from '@/lib/office/notifications';
import { publishPortalNotification } from '@/lib/portal/notifications';
import { checkSimpleRateLimit } from '@/lib/source-search/simple-rate-limit';
import { requirePortalClientAccess, resolvePortalCaseAccess } from '@/lib/portal/access';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { createAdminClient } from '@/utils/supabase/admin';

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  caseId: z.string().uuid(),
});

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());

  if (!parsed.success) {
    return new Response('Mesaj verisi geçersiz.', { status: 400 });
  }

  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const { context } = access;
  const ipAddress = extractRequestIp(request);
  const userAgent = request.headers.get('user-agent');
  const rateLimitKey = `portal:messages:user:${context.userId}:ip:${ipAddress}`;
  const rateLimit = checkSimpleRateLimit(
    rateLimitKey,
    parsePositiveInt(process.env.PORTAL_MESSAGE_RATE_LIMIT_PER_MINUTE, 18),
    parsePositiveInt(process.env.PORTAL_MESSAGE_RATE_LIMIT_WINDOW_MS, 60_000)
  );

  if (!rateLimit.allowed) {
    return Response.json(
      { error: 'Çok fazla mesaj gönderildi. Lütfen kısa süre sonra tekrar deneyin.' },
      {
        status: 429,
        headers: {
          'x-ratelimit-limit': String(rateLimit.limit),
          'x-ratelimit-remaining': String(rateLimit.remaining),
          'x-ratelimit-reset': String(rateLimit.resetAt),
        },
      }
    );
  }

  const caseAccess = await resolvePortalCaseAccess({
    caseId: parsed.data.caseId,
    clientId: context.clientId,
    profileUserId: context.userId,
    bureauId: context.bureauId,
  });

  if (!caseAccess) {
    return Response.json({ error: 'Bu dosya için mesaj gönderim yetkiniz yok.' }, { status: 403 });
  }

  const sentiment = detectRiskySentiment(parsed.data.message);
  const admin = createAdminClient();
  let persistedMessageId: string | null = null;
  let persistedToLedger = false;

  const insertResult = await admin
    .from('portal_case_messages')
    .insert({
      tenant_id: context.bureauId,
      case_id: parsed.data.caseId,
      client_id: context.clientId,
      sender_user_id: context.userId,
      body: parsed.data.message,
      metadata: {
        sentiment: {
          risky: sentiment.isRisky,
          matched: sentiment.matched,
        },
        source: 'portal',
      },
    })
    .select('id')
    .maybeSingle();

  if (insertResult.error && insertResult.error.code !== '42P01') {
    await writePortalAuditEvent({
      tenantId: context.bureauId,
      actorUserId: context.userId,
      eventType: 'portal_message_sent',
      objectType: 'portal_case_message',
      objectId: null,
      ipAddress,
      userAgent,
      result: 'error',
      metadata: {
        caseId: parsed.data.caseId,
        clientId: context.clientId,
        messageLength: parsed.data.message.length,
        rateLimitKey,
        risky: sentiment.isRisky,
        riskyKeywords: sentiment.matched,
      },
    });
    return Response.json({ error: 'Mesaj kaydedilemedi.' }, { status: 500 });
  }

  if (!insertResult.error && insertResult.data?.id) {
    persistedMessageId = insertResult.data.id;
    persistedToLedger = true;
  }

  if (sentiment.isRisky) {
    publishOfficeNotification({
      type: 'risk_communication',
      category: 'messages',
      title: 'Riskli İletişim Uyarısı',
      detail: `Dosya ${parsed.data.caseId} mesajında negatif ton algılandı: ${sentiment.matched.join(', ')}`,
      actionUrl: `/portal/cases/${parsed.data.caseId}`,
      actionLabel: 'Mesajı Gör',
      bureauId: caseAccess.bureau_id ?? undefined,
    });
  }

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_message_sent',
    objectType: 'portal_case_message',
    objectId: persistedMessageId,
    ipAddress,
    userAgent,
    result: 'success',
    metadata: {
      caseId: parsed.data.caseId,
      clientId: context.clientId,
      messageLength: parsed.data.message.length,
      rateLimitKey,
      risky: sentiment.isRisky,
      riskyKeywords: sentiment.matched,
    },
  });

  publishPortalNotification({
    tenantId: context.bureauId,
    userId: context.userId,
    clientId: context.clientId,
    type: 'message_received',
    category: 'messages',
    title: 'Mesajınız iletildi',
    detail: sentiment.isRisky
      ? 'Mesajınız kaydedildi ve risk işaretiyle ofis ekibine iletildi.'
      : 'Mesajınız ofis ekibine iletildi.',
    actionUrl: `/portal/cases/${parsed.data.caseId}`,
    actionLabel: 'Dosyayı Aç',
  });

  return Response.json({
    accepted: true,
    persisted: persistedToLedger,
    messageId: persistedMessageId,
    risky: sentiment.isRisky,
    matchedKeywords: sentiment.matched,
  });
}
