import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import {
  assertCaseAccessible,
  createSequenceCode,
  mapPaymentLinkRow,
  type FinanceAccessContext,
} from '@/lib/dashboard/finance';
import type { FinanceListResponse, FinancePaymentLink } from '@/types/finance-ops';

const querySchema = z.object({
  invoiceId: z.string().uuid().optional(),
  caseId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  status: z.enum(['pending', 'paid', 'failed', 'expired', 'cancelled']).optional(),
});

const createSchema = z.object({
  invoiceId: z.string().uuid().nullable().optional(),
  retainerId: z.string().uuid().nullable().optional(),
  caseId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  responsibleUserId: z.string().uuid().nullable().optional(),
  linkType: z.enum(['invoice', 'partial_invoice', 'retainer']),
  provider: z.string().trim().min(2).max(40),
  amount: z.coerce.number().positive().max(100000000),
  currency: z.string().trim().min(3).max(8).default('TRY'),
  expiresAt: z.string().datetime().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

const updateSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(['pending', 'paid', 'failed', 'expired', 'cancelled']).optional(),
    note: z.string().trim().max(1000).nullable().optional(),
    providerPayload: z.record(z.string(), z.unknown()).optional(),
    markWebhookTouched: z.boolean().optional(),
  })
  .refine((payload) => Object.keys(payload).length > 1, {
    message: 'Guncellenecek en az bir alan gereklidir.',
  });

function buildAccessContext(input: { userId: string; role: FinanceAccessContext['role']; bureauId: string }): FinanceAccessContext {
  return {
    userId: input.userId,
    role: input.role,
    bureauId: input.bureauId,
  };
}

async function ensureTableAvailable(admin: ReturnType<typeof createAdminClient>) {
  const probe = await admin.from('finance_payment_links').select('id').limit(1);
  if (probe.error?.code === '42P01') {
    throw new Error('Finance tablolari hazir degil. rag_v2_step33_finance_ops_core.sql migrationini calistirin.');
  }
}

export async function GET(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  try {
    const admin = createAdminClient();
    await ensureTableAvailable(admin);

    const params = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({
      invoiceId: params.get('invoiceId') ?? undefined,
      caseId: params.get('caseId') ?? undefined,
      clientId: params.get('clientId') ?? undefined,
      status: params.get('status') ?? undefined,
    });

    if (!parsed.success) {
      return Response.json({ error: 'Gecersiz filtre parametreleri.' }, { status: 400 });
    }

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, parsed.data.caseId);

    let query = admin
      .from('finance_payment_links')
      .select(
        'id, link_code, invoice_id, retainer_id, case_id, client_id, responsible_user_id, link_type, status, provider, amount, currency, url, expires_at, paid_at, failed_at, created_at',
      )
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(400);

    if (parsed.data.invoiceId) {
      query = query.eq('invoice_id', parsed.data.invoiceId);
    }
    if (parsed.data.caseId) {
      query = query.eq('case_id', parsed.data.caseId);
    }
    if (parsed.data.clientId) {
      query = query.eq('client_id', parsed.data.clientId);
    }
    if (parsed.data.status) {
      query = query.eq('status', parsed.data.status);
    }

    const result = await query;
    if (result.error) {
      return Response.json({ error: 'Odeme linkleri alinamadi.' }, { status: 500 });
    }

    const items = ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => mapPaymentLinkRow(row));
    const payload: FinanceListResponse<FinancePaymentLink> = { items };

    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Odeme linki servis hatasi.';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  try {
    const payload = createSchema.safeParse(await request.json());
    if (!payload.success) {
      return Response.json({ error: 'Gecersiz odeme linki verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTableAvailable(admin);

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, payload.data.caseId ?? null);

    const linkCode = createSequenceCode('LNK');
    const origin = new URL(request.url).origin;
    const linkUrl = `${origin}/pay/${linkCode}`;

    const insertResult = await admin
      .from('finance_payment_links')
      .insert({
        bureau_id: access.bureauId,
        link_code: linkCode,
        invoice_id: payload.data.invoiceId ?? null,
        retainer_id: payload.data.retainerId ?? null,
        case_id: payload.data.caseId ?? null,
        client_id: payload.data.clientId ?? null,
        responsible_user_id: payload.data.responsibleUserId ?? access.userId,
        link_type: payload.data.linkType,
        status: 'pending',
        provider: payload.data.provider,
        amount: payload.data.amount,
        currency: payload.data.currency,
        url: linkUrl,
        expires_at: payload.data.expiresAt ?? null,
        note: payload.data.note ?? null,
        created_by: access.userId,
      })
      .select(
        'id, link_code, invoice_id, retainer_id, case_id, client_id, responsible_user_id, link_type, status, provider, amount, currency, url, expires_at, paid_at, failed_at, created_at',
      )
      .single();

    if (insertResult.error || !insertResult.data) {
      if (insertResult.error?.code === '23505') {
        return Response.json({ error: 'Odeme link kodu cakisti. Tekrar deneyin.' }, { status: 409 });
      }
      return Response.json({ error: 'Odeme linki olusturulamadi.' }, { status: 500 });
    }

    return Response.json({ item: mapPaymentLinkRow(insertResult.data as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Odeme linki olusturulamadi.';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  try {
    const payload = updateSchema.safeParse(await request.json());
    if (!payload.success) {
      return Response.json({ error: 'Gecersiz odeme linki guncelleme verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTableAvailable(admin);

    const currentResult = await admin
      .from('finance_payment_links')
      .select(
        'id, case_id, status, note, provider_payload, last_webhook_at, paid_at, failed_at, link_code, invoice_id, retainer_id, client_id, responsible_user_id, link_type, provider, amount, currency, url, expires_at, created_at',
      )
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .maybeSingle();

    if (currentResult.error || !currentResult.data) {
      return Response.json({ error: 'Odeme linki bulunamadi.' }, { status: 404 });
    }

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, currentResult.data.case_id);

    const nextStatus = payload.data.status ?? currentResult.data.status;
    const nowIso = new Date().toISOString();

    const updateResult = await admin
      .from('finance_payment_links')
      .update({
        status: nextStatus,
        note: payload.data.note ?? currentResult.data.note,
        provider_payload: payload.data.providerPayload ?? currentResult.data.provider_payload ?? {},
        last_webhook_at: payload.data.markWebhookTouched ? nowIso : currentResult.data.last_webhook_at,
        paid_at:
          nextStatus === 'paid'
            ? currentResult.data.paid_at ?? nowIso
            : nextStatus === 'pending'
              ? null
              : currentResult.data.paid_at,
        failed_at:
          nextStatus === 'failed'
            ? currentResult.data.failed_at ?? nowIso
            : nextStatus === 'pending'
              ? null
              : currentResult.data.failed_at,
      })
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .select(
        'id, link_code, invoice_id, retainer_id, case_id, client_id, responsible_user_id, link_type, status, provider, amount, currency, url, expires_at, paid_at, failed_at, created_at',
      )
      .single();

    if (updateResult.error || !updateResult.data) {
      return Response.json({ error: 'Odeme linki guncellenemedi.' }, { status: 500 });
    }

    return Response.json({ item: mapPaymentLinkRow(updateResult.data as Record<string, unknown>) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Odeme linki guncellenemedi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
