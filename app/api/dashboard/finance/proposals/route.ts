import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import {
  assertCaseAccessible,
  createSequenceCode,
  mapProposalRow,
  utcDateOnly,
  type FinanceAccessContext,
} from '@/lib/dashboard/finance';
import type { FinanceListResponse, FinanceProposal } from '@/types/finance-ops';

const querySchema = z.object({
  caseId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired']).optional(),
});

const createSchema = z.object({
  caseId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  responsibleUserId: z.string().uuid().nullable().optional(),
  billingModel: z.enum(['hourly', 'fixed_fee', 'success_fee', 'retainer', 'mixed']).default('hourly'),
  proposalDate: z.string().date().optional(),
  validUntil: z.string().date().nullable().optional(),
  hourlyRate: z.coerce.number().min(0).max(100000000).nullable().optional(),
  fixedFeeAmount: z.coerce.number().min(0).max(100000000).nullable().optional(),
  successFeeRate: z.coerce.number().min(0).max(100).nullable().optional(),
  retainerAmount: z.coerce.number().min(0).max(100000000).nullable().optional(),
  vatRate: z.coerce.number().min(0).max(100).nullable().optional(),
  withholdingRate: z.coerce.number().min(0).max(100).nullable().optional(),
  currency: z.string().trim().min(3).max(8).default('TRY'),
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired']).default('draft'),
  notes: z.string().trim().max(4000).nullable().optional(),
});

const updateSchema = createSchema
  .partial()
  .extend({
    id: z.string().uuid(),
  })
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
  const probe = await admin.from('finance_proposals').select('id').limit(1);
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
      status: params.get('status') ?? undefined,
    });

    if (!parsed.success) {
      return Response.json({ error: 'Gecersiz filtre parametreleri.' }, { status: 400 });
    }

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, parsed.data.caseId);

    let query = admin
      .from('finance_proposals')
      .select(
        'id, proposal_no, case_id, client_id, responsible_user_id, billing_model, proposal_date, valid_until, hourly_rate, fixed_fee_amount, success_fee_rate, retainer_amount, vat_rate, withholding_rate, currency, status, notes, created_at, updated_at',
      )
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .order('proposal_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(300);

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
      return Response.json({ error: 'Teklifler alinamadi.' }, { status: 500 });
    }

    const items: FinanceProposal[] = ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => mapProposalRow(row));
    const payload: FinanceListResponse<FinanceProposal> = { items };
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Teklif servis hatasi.';
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
      return Response.json({ error: 'Gecersiz teklif verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTableAvailable(admin);

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, payload.data.caseId ?? null);

    const insertResult = await admin
      .from('finance_proposals')
      .insert({
        bureau_id: access.bureauId,
        proposal_no: createSequenceCode('PRP'),
        case_id: payload.data.caseId ?? null,
        client_id: payload.data.clientId ?? null,
        responsible_user_id: payload.data.responsibleUserId ?? access.userId,
        billing_model: payload.data.billingModel,
        proposal_date: payload.data.proposalDate ?? utcDateOnly(new Date()),
        valid_until: payload.data.validUntil ?? null,
        hourly_rate: payload.data.hourlyRate ?? null,
        fixed_fee_amount: payload.data.fixedFeeAmount ?? null,
        success_fee_rate: payload.data.successFeeRate ?? null,
        retainer_amount: payload.data.retainerAmount ?? null,
        vat_rate: payload.data.vatRate ?? null,
        withholding_rate: payload.data.withholdingRate ?? null,
        currency: payload.data.currency,
        status: payload.data.status,
        notes: payload.data.notes ?? null,
        created_by: access.userId,
      })
      .select(
        'id, proposal_no, case_id, client_id, responsible_user_id, billing_model, proposal_date, valid_until, hourly_rate, fixed_fee_amount, success_fee_rate, retainer_amount, vat_rate, withholding_rate, currency, status, notes, created_at, updated_at',
      )
      .single();

    if (insertResult.error || !insertResult.data) {
      if (insertResult.error?.code === '23505') {
        return Response.json({ error: 'Teklif numarasi cakisti. Tekrar deneyin.' }, { status: 409 });
      }
      return Response.json({ error: 'Teklif olusturulamadi.' }, { status: 500 });
    }

    return Response.json({ item: mapProposalRow(insertResult.data as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Teklif servis hatasi.';
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
      return Response.json({ error: 'Gecersiz teklif guncelleme verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTableAvailable(admin);

    const currentResult = await admin
      .from('finance_proposals')
      .select(
        'id, case_id, client_id, responsible_user_id, billing_model, proposal_date, valid_until, hourly_rate, fixed_fee_amount, success_fee_rate, retainer_amount, vat_rate, withholding_rate, currency, status, notes',
      )
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .maybeSingle();

    if (currentResult.error || !currentResult.data) {
      return Response.json({ error: 'Teklif bulunamadi.' }, { status: 404 });
    }

    const nextCaseId = payload.data.caseId ?? currentResult.data.case_id;
    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, nextCaseId ?? null);

    const updateResult = await admin
      .from('finance_proposals')
      .update({
        case_id: nextCaseId,
        client_id: payload.data.clientId ?? currentResult.data.client_id,
        responsible_user_id: payload.data.responsibleUserId ?? currentResult.data.responsible_user_id,
        billing_model: payload.data.billingModel ?? currentResult.data.billing_model,
        proposal_date: payload.data.proposalDate ?? currentResult.data.proposal_date,
        valid_until: payload.data.validUntil ?? currentResult.data.valid_until,
        hourly_rate: payload.data.hourlyRate ?? currentResult.data.hourly_rate,
        fixed_fee_amount: payload.data.fixedFeeAmount ?? currentResult.data.fixed_fee_amount,
        success_fee_rate: payload.data.successFeeRate ?? currentResult.data.success_fee_rate,
        retainer_amount: payload.data.retainerAmount ?? currentResult.data.retainer_amount,
        vat_rate: payload.data.vatRate ?? currentResult.data.vat_rate,
        withholding_rate: payload.data.withholdingRate ?? currentResult.data.withholding_rate,
        currency: payload.data.currency ?? currentResult.data.currency,
        status: payload.data.status ?? currentResult.data.status,
        notes: payload.data.notes ?? currentResult.data.notes,
      })
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .select(
        'id, proposal_no, case_id, client_id, responsible_user_id, billing_model, proposal_date, valid_until, hourly_rate, fixed_fee_amount, success_fee_rate, retainer_amount, vat_rate, withholding_rate, currency, status, notes, created_at, updated_at',
      )
      .single();

    if (updateResult.error || !updateResult.data) {
      return Response.json({ error: 'Teklif guncellenemedi.' }, { status: 500 });
    }

    return Response.json({ item: mapProposalRow(updateResult.data as Record<string, unknown>) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Teklif guncellenemedi.';
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
      .from('finance_proposals')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    if (deleteResult.error || !deleteResult.data) {
      return Response.json({ error: 'Teklif silinemedi.' }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Teklif silinemedi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
