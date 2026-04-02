import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { canAccessClient, resolveAccessibleClientIds, resolveInternalUserBureauScope } from '@/lib/dashboard/client-access';
import type { AssistantTool, ToolExecutionInput } from '@/lib/tools/types';

const sendClientMessageSchema = z.object({
  clientId: z.string().uuid().optional(),
  clientName: z.string().min(2).max(120).optional(),
  body: z.string().min(1).max(5000),
  sendEmailAlso: z.boolean().optional().default(false),
  subject: z.string().trim().max(240).optional(),
});

type CandidateClient = {
  id: string;
  full_name: string;
  email: string | null;
};

function normalizeName(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarityScore(a: string, b: string) {
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.92;
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const denom = Math.max(1, Math.max(aTokens.size, bTokens.size));
  return intersection / denom;
}

async function resolveClientByName(input: {
  userId: string;
  clientId?: string;
  clientName?: string;
}): Promise<{ client: CandidateClient | null; ambiguous: CandidateClient[] }> {
  const admin = createAdminClient();

  if (input.clientId) {
    const singleResult = await admin
      .from('clients')
      .select('id, full_name, email')
      .eq('id', input.clientId)
      .is('deleted_at', null)
      .maybeSingle<CandidateClient>();

    if (singleResult.error || !singleResult.data) {
      return { client: null, ambiguous: [] };
    }

    const allowed = await canAccessClient(admin, {
      clientId: input.clientId,
      userId: input.userId,
    });

    return {
      client: allowed ? singleResult.data : null,
      ambiguous: [],
    };
  }

  if (!input.clientName) {
    return { client: null, ambiguous: [] };
  }

  const scope = await resolveInternalUserBureauScope(admin, input.userId);
  if (!scope) {
    return { client: null, ambiguous: [] };
  }

  const candidatesResult = await admin
    .from('clients')
    .select('id, full_name, email')
    .ilike('full_name', `%${input.clientName}%`)
    .is('deleted_at', null)
    .limit(18);

  if (candidatesResult.error || !candidatesResult.data || candidatesResult.data.length === 0) {
    return { client: null, ambiguous: [] };
  }

  const allowedIds = await resolveAccessibleClientIds(admin, {
    clientIds: candidatesResult.data.map((item) => item.id),
    bureauId: scope.bureauId,
    bureauProfileIds: scope.bureauProfileIds,
  });

  const allowed = candidatesResult.data.filter((item) => allowedIds.has(item.id));
  if (allowed.length === 0) {
    return { client: null, ambiguous: [] };
  }

  const target = normalizeName(input.clientName);
  const ranked = allowed
    .map((item) => ({
      client: item,
      score: similarityScore(normalizeName(item.full_name), target),
    }))
    .sort((a, b) => b.score - a.score);

  if (!ranked[0] || ranked[0].score < 0.4) {
    return { client: null, ambiguous: [] };
  }

  const topScore = ranked[0].score;
  const closeMatches = ranked.filter((item) => topScore - item.score <= 0.07).map((item) => item.client);

  if (closeMatches.length > 1) {
    return { client: null, ambiguous: closeMatches.slice(0, 5) };
  }

  return {
    client: ranked[0].client,
    ambiguous: [],
  };
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
      reason: 'E-posta kanalı tanımlı değil (CLIENT_EMAIL_WEBHOOK_URL yok).',
    } as const;
  }

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        ok: false,
        reason: errorText.slice(0, 240) || 'E-posta servisi hata döndürdü.',
      } as const;
    }

    return { ok: true as const };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'E-posta isteği başarısız oldu.',
    } as const;
  }
}

export const sendClientMessageTool: AssistantTool = {
  name: 'clients.message.send',
  label: 'Müvekkile mesaj gönder',
  description: 'Müvekkile uygulama içi mesaj gönderir; istenirse e-posta da yollar.',
  requiresConfirmation: true,
  async preview(input: ToolExecutionInput) {
    const parsed = sendClientMessageSchema.parse({
      clientId: typeof input.params.clientId === 'string' ? input.params.clientId : undefined,
      clientName: typeof input.params.clientName === 'string' ? input.params.clientName : undefined,
      body: typeof input.params.body === 'string' ? input.params.body : '',
      sendEmailAlso: Boolean(input.params.sendEmailAlso),
      subject: typeof input.params.subject === 'string' ? input.params.subject : undefined,
    });

    const resolved = await resolveClientByName({
      userId: input.context.user.id,
      clientId: parsed.clientId,
      clientName: parsed.clientName,
    });

    if (resolved.ambiguous.length > 0) {
      return {
        summary: 'Birden fazla müvekkil bulundu. Lütfen daha net isim belirt.',
        preview: {
          ambiguousClients: resolved.ambiguous.map((item) => ({
            id: item.id,
            fullName: item.full_name,
          })),
          bodyPreview: parsed.body.slice(0, 200),
        },
        requiresConfirmation: true,
      };
    }

    if (!resolved.client) {
      throw new Error('Müvekkil bulunamadı veya erişim yetkin yok.');
    }

    return {
      summary: `${resolved.client.full_name} için mesaj hazırlandı. Onay sonrası gönderilecek.`,
      preview: {
        clientId: resolved.client.id,
        clientName: resolved.client.full_name,
        sendEmailAlso: parsed.sendEmailAlso,
        bodyPreview: parsed.body.slice(0, 300),
      },
      requiresConfirmation: true,
    };
  },
  async run(input: ToolExecutionInput) {
    const parsed = sendClientMessageSchema.parse({
      clientId: typeof input.params.clientId === 'string' ? input.params.clientId : undefined,
      clientName: typeof input.params.clientName === 'string' ? input.params.clientName : undefined,
      body: typeof input.params.body === 'string' ? input.params.body : '',
      sendEmailAlso: Boolean(input.params.sendEmailAlso),
      subject: typeof input.params.subject === 'string' ? input.params.subject : undefined,
    });

    const resolved = await resolveClientByName({
      userId: input.context.user.id,
      clientId: parsed.clientId,
      clientName: parsed.clientName,
    });

    if (resolved.ambiguous.length > 0) {
      throw new Error('Birden fazla müvekkil eşleşti. Lütfen tam isim belirt.');
    }

    if (!resolved.client) {
      throw new Error('Müvekkil bulunamadı veya erişim yetkin yok.');
    }

    const admin = createAdminClient();

    const messageInsert = await admin
      .from('messages')
      .insert({
        client_id: resolved.client.id,
        sender_user_id: input.context.user.id,
        message_type: 'direct',
        body: parsed.body,
        metadata: {
          sendEmailAlso: parsed.sendEmailAlso,
          source: 'assistant_icon',
        },
        status: parsed.sendEmailAlso ? 'pending' : 'sent',
      })
      .select('id, public_ref_code, created_at')
      .single<{ id: string; public_ref_code: string | null; created_at: string }>();

    if (messageInsert.error || !messageInsert.data) {
      throw new Error('Mesaj kaydı oluşturulamadı.');
    }

    const message = messageInsert.data;

    await admin.from('message_deliveries').insert({
      message_id: message.id,
      channel: 'in_app',
      status: 'sent',
      attempts: 1,
      delivered_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
    });

    let emailStatus: 'pending' | 'sent' | 'failed' | null = null;
    let emailError: string | null = null;

    if (parsed.sendEmailAlso) {
      if (!resolved.client.email) {
        emailStatus = 'failed';
        emailError = 'Müvekkil e-posta adresi bulunamadı.';
      } else {
        const emailResult = await attemptEmailDelivery({
          to: resolved.client.email,
          subject: parsed.subject?.trim() || 'Ofis Mesajı',
          body: parsed.body,
          messageId: message.id,
          clientId: resolved.client.id,
        });
        emailStatus = emailResult.ok ? 'sent' : 'failed';
        emailError = emailResult.ok ? null : emailResult.reason;
      }

      await admin.from('message_deliveries').insert({
        message_id: message.id,
        channel: 'email',
        status: emailStatus,
        attempts: 1,
        error_message: emailError,
        delivered_at: emailStatus === 'sent' ? new Date().toISOString() : null,
        last_attempt_at: new Date().toISOString(),
      });

      await admin
        .from('messages')
        .update({
          status: emailStatus === 'failed' ? 'failed' : 'sent',
          updated_at: new Date().toISOString(),
        })
        .eq('id', message.id);
    }

    return {
      summary: `${resolved.client.full_name} için mesaj gönderildi.${parsed.sendEmailAlso ? ` E-posta durumu: ${emailStatus}.` : ''}`,
      output: {
        messageId: message.id,
        clientId: resolved.client.id,
        clientName: resolved.client.full_name,
        publicRefCode: message.public_ref_code,
        emailStatus,
        emailError,
        directiveType: 'NAVIGATE',
        route: `/dashboard/clients/${resolved.client.id}`,
      },
    };
  },
};
