import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { requirePortalClientAccess } from '@/lib/portal/access';

const bodySchema = z.object({
  consentType: z.string().trim().min(1).max(120),
  consentVersion: z.string().trim().min(1).max(40),
  accepted: z.boolean(),
  legalBasis: z.string().trim().max(120).optional(),
  locale: z.string().trim().max(16).optional(),
  proofPayload: z.record(z.string(), z.unknown()).optional(),
  withdrawnReason: z.string().trim().max(500).optional(),
});

export async function GET(request: Request) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const context = access.context;
  const admin = createAdminClient();
  const result = await admin
    .from('consents')
    .select('id, consent_type, consent_version, legal_basis, accepted, accepted_at, withdrawn_at, withdrawn_reason, locale, proof_payload, created_at')
    .eq('tenant_id', context.bureauId)
    .eq('user_id', context.userId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (result.error) {
    if (result.error.code === '42P01') {
      return Response.json({ items: [] });
    }
    return Response.json({ error: 'Rıza kayıtları alınamadı.' }, { status: 500 });
  }

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_consents_viewed',
    objectType: 'consent_collection',
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      itemCount: (result.data ?? []).length,
    },
  }).catch(() => undefined);

  return Response.json({
    items: (result.data ?? []).map((item) => ({
      id: item.id,
      consentType: item.consent_type,
      consentVersion: item.consent_version,
      legalBasis: item.legal_basis,
      accepted: item.accepted,
      acceptedAt: item.accepted_at,
      withdrawnAt: item.withdrawn_at,
      withdrawnReason: item.withdrawn_reason,
      locale: item.locale,
      proofPayload: item.proof_payload ?? {},
      createdAt: item.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz rıza isteği.' }, { status: 400 });
  }

  const context = access.context;
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  if (parsed.data.accepted) {
    const upsertResult = await admin.from('consents').upsert(
      {
        tenant_id: context.bureauId,
        user_id: context.userId,
        consent_type: parsed.data.consentType,
        consent_version: parsed.data.consentVersion,
        legal_basis: parsed.data.legalBasis ?? null,
        accepted: true,
        accepted_at: nowIso,
        withdrawn_at: null,
        withdrawn_reason: null,
        locale: parsed.data.locale ?? 'tr-TR',
        proof_payload: parsed.data.proofPayload ?? {},
      },
      {
        onConflict: 'tenant_id,user_id,consent_type,consent_version',
      }
    );

    if (upsertResult.error) {
      if (upsertResult.error.code === '42P01') {
        return Response.json({ error: 'Rıza altyapısı henüz etkin değil.' }, { status: 503 });
      }
      return Response.json({ error: 'Rıza kaydı oluşturulamadı.' }, { status: 500 });
    }
  } else {
    const withdrawResult = await admin
      .from('consents')
      .update({
        accepted: false,
        withdrawn_at: nowIso,
        withdrawn_reason: parsed.data.withdrawnReason ?? null,
      })
      .eq('tenant_id', context.bureauId)
      .eq('user_id', context.userId)
      .eq('consent_type', parsed.data.consentType)
      .eq('consent_version', parsed.data.consentVersion)
      .is('withdrawn_at', null);

    if (withdrawResult.error) {
      if (withdrawResult.error.code === '42P01') {
        return Response.json({ error: 'Rıza altyapısı henüz etkin değil.' }, { status: 503 });
      }
      return Response.json({ error: 'Rıza geri çekme işlemi başarısız.' }, { status: 500 });
    }
  }

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: parsed.data.accepted ? 'portal_consent_granted' : 'portal_consent_withdrawn',
    objectType: 'consent',
    objectId: `${parsed.data.consentType}:${parsed.data.consentVersion}`,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      consentType: parsed.data.consentType,
      consentVersion: parsed.data.consentVersion,
      accepted: parsed.data.accepted,
    },
  }).catch(() => undefined);

  return Response.json({
    success: true,
  });
}

