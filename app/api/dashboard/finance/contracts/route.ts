import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import {
  assertCaseAccessible,
  createSequenceCode,
  mapContractRow,
  utcDateOnly,
  type FinanceAccessContext,
} from '@/lib/dashboard/finance';
import type { FinanceContract, FinanceListResponse } from '@/types/finance-ops';

const querySchema = z.object({
  caseId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  proposalId: z.string().uuid().optional(),
  status: z.enum(['draft', 'active', 'expired', 'terminated']).optional(),
});

const createSchema = z.object({
  caseId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  responsibleUserId: z.string().uuid().nullable().optional(),
  proposalId: z.string().uuid().nullable().optional(),
  billingModel: z.enum(['hourly', 'fixed_fee', 'success_fee', 'retainer', 'mixed']).default('hourly'),
  signedAt: z.string().date().nullable().optional(),
  startsAt: z.string().date().nullable().optional(),
  endsAt: z.string().date().nullable().optional(),
  hourlyRate: z.coerce.number().min(0).max(100000000).nullable().optional(),
  fixedFeeAmount: z.coerce.number().min(0).max(100000000).nullable().optional(),
  successFeeRate: z.coerce.number().min(0).max(100).nullable().optional(),
  monthlyRetainerAmount: z.coerce.number().min(0).max(100000000).nullable().optional(),
  vatRate: z.coerce.number().min(0).max(100).nullable().optional(),
  withholdingRate: z.coerce.number().min(0).max(100).nullable().optional(),
  currency: z.string().trim().min(3).max(8).default('TRY'),
  status: z.enum(['draft', 'active', 'expired', 'terminated']).default('draft'),
  terms: z.string().trim().max(10000).nullable().optional(),
});

const updateSchema = createSchema
  .partial()
  .extend({ id: z.string().uuid() })
  .refine((payload) => Object.keys(payload).length > 1, {
    message: 'Guncellenecek en az bir alan gereklidir.',
  });

const deleteSchema = z.object({
  id: z.string().uuid(),
});

function buildAccessContext(input: { userId: string; role: FinanceAccessContext['role']; bureauId: string }): FinanceAccessContext {
  return {
    userId: input.userId,
    role: input.role,
    bureauId: input.bureauId,
  };
}

async function ensureTableAvailable(admin: ReturnType<typeof createAdminClient>) {
  const probe = await admin.from('finance_contracts').select('id').limit(1);
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
      caseId: params.get('caseId') ?? undefined,
      clientId: params.get('clientId') ?? undefined,
      proposalId: params.get('proposalId') ?? undefined,
      status: params.get('status') ?? undefined,
    });

    if (!parsed.success) {
      return Response.json({ error: 'Gecersiz filtre parametreleri.' }, { status: 400 });
    }

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, parsed.data.caseId);

    let query = admin
      .from('finance_contracts')
      .select(
        'id, contract_no, case_id, client_id, responsible_user_id, proposal_id, billing_model, signed_at, starts_at, ends_at, hourly_rate, fixed_fee_amount, success_fee_rate, monthly_retainer_amount, vat_rate, withholding_rate, currency, status, terms, created_at, updated_at',
      )
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(300);

    if (parsed.data.caseId) {
      query = query.eq('case_id', parsed.data.caseId);
    }
    if (parsed.data.clientId) {
      query = query.eq('client_id', parsed.data.clientId);
    }
    if (parsed.data.proposalId) {
      query = query.eq('proposal_id', parsed.data.proposalId);
    }
    if (parsed.data.status) {
      query = query.eq('status', parsed.data.status);
    }

    const result = await query;
    if (result.error) {
      return Response.json({ error: 'Sozlesmeler alinamadi.' }, { status: 500 });
    }

    const items: FinanceContract[] = ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => mapContractRow(row));
    const payload: FinanceListResponse<FinanceContract> = { items };

    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sozlesme servis hatasi.';
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
      return Response.json({ error: 'Gecersiz sozlesme verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTableAvailable(admin);

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, payload.data.caseId ?? null);

    const insertResult = await admin
      .from('finance_contracts')
      .insert({
        bureau_id: access.bureauId,
        contract_no: createSequenceCode('CTR'),
        case_id: payload.data.caseId ?? null,
        client_id: payload.data.clientId ?? null,
        responsible_user_id: payload.data.responsibleUserId ?? access.userId,
        proposal_id: payload.data.proposalId ?? null,
        billing_model: payload.data.billingModel,
        signed_at: payload.data.signedAt ?? utcDateOnly(new Date()),
        starts_at: payload.data.startsAt ?? null,
        ends_at: payload.data.endsAt ?? null,
        hourly_rate: payload.data.hourlyRate ?? null,
        fixed_fee_amount: payload.data.fixedFeeAmount ?? null,
        success_fee_rate: payload.data.successFeeRate ?? null,
        monthly_retainer_amount: payload.data.monthlyRetainerAmount ?? null,
        vat_rate: payload.data.vatRate ?? null,
        withholding_rate: payload.data.withholdingRate ?? null,
        currency: payload.data.currency,
        status: payload.data.status,
        terms: payload.data.terms ?? null,
        created_by: access.userId,
      })
      .select(
        'id, contract_no, case_id, client_id, responsible_user_id, proposal_id, billing_model, signed_at, starts_at, ends_at, hourly_rate, fixed_fee_amount, success_fee_rate, monthly_retainer_amount, vat_rate, withholding_rate, currency, status, terms, created_at, updated_at',
      )
      .single();

    if (insertResult.error || !insertResult.data) {
      if (insertResult.error?.code === '23505') {
        return Response.json({ error: 'Sozlesme numarasi cakisti. Tekrar deneyin.' }, { status: 409 });
      }
      return Response.json({ error: 'Sozlesme olusturulamadi.' }, { status: 500 });
    }

    return Response.json({ item: mapContractRow(insertResult.data as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sozlesme servis hatasi.';
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
      return Response.json({ error: 'Gecersiz sozlesme guncelleme verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTableAvailable(admin);

    const currentResult = await admin
      .from('finance_contracts')
      .select(
        'id, case_id, client_id, responsible_user_id, proposal_id, billing_model, signed_at, starts_at, ends_at, hourly_rate, fixed_fee_amount, success_fee_rate, monthly_retainer_amount, vat_rate, withholding_rate, currency, status, terms',
      )
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .maybeSingle();

    if (currentResult.error || !currentResult.data) {
      return Response.json({ error: 'Sozlesme bulunamadi.' }, { status: 404 });
    }

    const nextCaseId = payload.data.caseId ?? currentResult.data.case_id;
    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, nextCaseId ?? null);

    const updateResult = await admin
      .from('finance_contracts')
      .update({
        case_id: nextCaseId,
        client_id: payload.data.clientId ?? currentResult.data.client_id,
        responsible_user_id: payload.data.responsibleUserId ?? currentResult.data.responsible_user_id,
        proposal_id: payload.data.proposalId ?? currentResult.data.proposal_id,
        billing_model: payload.data.billingModel ?? currentResult.data.billing_model,
        signed_at: payload.data.signedAt ?? currentResult.data.signed_at,
        starts_at: payload.data.startsAt ?? currentResult.data.starts_at,
        ends_at: payload.data.endsAt ?? currentResult.data.ends_at,
        hourly_rate: payload.data.hourlyRate ?? currentResult.data.hourly_rate,
        fixed_fee_amount: payload.data.fixedFeeAmount ?? currentResult.data.fixed_fee_amount,
        success_fee_rate: payload.data.successFeeRate ?? currentResult.data.success_fee_rate,
        monthly_retainer_amount: payload.data.monthlyRetainerAmount ?? currentResult.data.monthly_retainer_amount,
        vat_rate: payload.data.vatRate ?? currentResult.data.vat_rate,
        withholding_rate: payload.data.withholdingRate ?? currentResult.data.withholding_rate,
        currency: payload.data.currency ?? currentResult.data.currency,
        status: payload.data.status ?? currentResult.data.status,
        terms: payload.data.terms ?? currentResult.data.terms,
      })
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .select(
        'id, contract_no, case_id, client_id, responsible_user_id, proposal_id, billing_model, signed_at, starts_at, ends_at, hourly_rate, fixed_fee_amount, success_fee_rate, monthly_retainer_amount, vat_rate, withholding_rate, currency, status, terms, created_at, updated_at',
      )
      .single();

    if (updateResult.error || !updateResult.data) {
      return Response.json({ error: 'Sozlesme guncellenemedi.' }, { status: 500 });
    }

    return Response.json({ item: mapContractRow(updateResult.data as Record<string, unknown>) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sozlesme guncellenemedi.';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  try {
    const payload = deleteSchema.safeParse(await request.json());
    if (!payload.success) {
      return Response.json({ error: 'Gecersiz silme istegi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTableAvailable(admin);

    const deleteResult = await admin
      .from('finance_contracts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    if (deleteResult.error || !deleteResult.data) {
      return Response.json({ error: 'Sozlesme silinemedi.' }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sozlesme silinemedi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
