import Decimal from 'decimal.js';
import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import {
  assertCaseAccessible,
  createSequenceCode,
  mapRetainerRow,
  toNumber,
  utcDateOnly,
  type FinanceAccessContext,
} from '@/lib/dashboard/finance';
import type { FinanceListResponse, FinanceRetainer } from '@/types/finance-ops';

const querySchema = z.object({
  caseId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  status: z.enum(['active', 'exhausted', 'refunded', 'closed']).optional(),
  retainerType: z.enum(['service', 'expense']).optional(),
});

const createSchema = z.object({
  caseId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  responsibleUserId: z.string().uuid().nullable().optional(),
  contractId: z.string().uuid().nullable().optional(),
  retainerType: z.enum(['service', 'expense']),
  receivedDate: z.string().date().optional(),
  amount: z.coerce.number().positive().max(100000000),
  refundableAmount: z.coerce.number().min(0).max(100000000).optional(),
  currency: z.string().trim().min(3).max(8).default('TRY'),
  note: z.string().trim().max(4000).nullable().optional(),
});

const allocationSchema = z.object({
  amount: z.coerce.number().positive().max(100000000),
  allocationDate: z.string().date().optional(),
  invoiceId: z.string().uuid().nullable().optional(),
  expenseId: z.string().uuid().nullable().optional(),
  paymentId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

const updateSchema = z
  .object({
    id: z.string().uuid(),
    caseId: z.string().uuid().nullable().optional(),
    clientId: z.string().uuid().nullable().optional(),
    responsibleUserId: z.string().uuid().nullable().optional(),
    contractId: z.string().uuid().nullable().optional(),
    status: z.enum(['active', 'exhausted', 'refunded', 'closed']).optional(),
    receivedDate: z.string().date().optional(),
    refundableAmount: z.coerce.number().min(0).max(100000000).optional(),
    currency: z.string().trim().min(3).max(8).optional(),
    note: z.string().trim().max(4000).nullable().optional(),
    allocation: allocationSchema.optional(),
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

function deriveRetainerStatus(input: { remainingAmount: number; currentStatus: FinanceRetainer['status'] }): FinanceRetainer['status'] {
  if (input.currentStatus === 'closed' || input.currentStatus === 'refunded') {
    return input.currentStatus;
  }
  if (input.remainingAmount <= 0) {
    return 'exhausted';
  }
  return 'active';
}

async function ensureTablesAvailable(admin: ReturnType<typeof createAdminClient>) {
  const [retainerProbe, allocationProbe] = await Promise.all([
    admin.from('finance_retainers').select('id').limit(1),
    admin.from('finance_retainer_allocations').select('id').limit(1),
  ]);

  if (retainerProbe.error?.code === '42P01' || allocationProbe.error?.code === '42P01') {
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
    await ensureTablesAvailable(admin);

    const params = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({
      caseId: params.get('caseId') ?? undefined,
      clientId: params.get('clientId') ?? undefined,
      status: params.get('status') ?? undefined,
      retainerType: params.get('retainerType') ?? undefined,
    });

    if (!parsed.success) {
      return Response.json({ error: 'Gecersiz filtre parametreleri.' }, { status: 400 });
    }

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, parsed.data.caseId);

    let query = admin
      .from('finance_retainers')
      .select(
        'id, retainer_no, case_id, client_id, responsible_user_id, contract_id, retainer_type, status, received_date, amount, used_amount, remaining_amount, refundable_amount, currency, note, created_at, updated_at',
      )
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .order('received_date', { ascending: false })
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
    if (parsed.data.retainerType) {
      query = query.eq('retainer_type', parsed.data.retainerType);
    }

    const result = await query;
    if (result.error) {
      return Response.json({ error: 'Avans listesi alinamadi.' }, { status: 500 });
    }

    const items: FinanceRetainer[] = ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => mapRetainerRow(row));
    const payload: FinanceListResponse<FinanceRetainer> = { items };
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Avans servis hatasi.';
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
      return Response.json({ error: 'Gecersiz avans verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTablesAvailable(admin);

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, payload.data.caseId ?? null);

    const amount = new Decimal(payload.data.amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const refundableAmount = new Decimal(payload.data.refundableAmount ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const insertResult = await admin
      .from('finance_retainers')
      .insert({
        bureau_id: access.bureauId,
        retainer_no: createSequenceCode('RTN'),
        case_id: payload.data.caseId ?? null,
        client_id: payload.data.clientId ?? null,
        responsible_user_id: payload.data.responsibleUserId ?? access.userId,
        contract_id: payload.data.contractId ?? null,
        retainer_type: payload.data.retainerType,
        status: 'active',
        received_date: payload.data.receivedDate ?? utcDateOnly(new Date()),
        amount: amount.toNumber(),
        used_amount: 0,
        remaining_amount: amount.toNumber(),
        refundable_amount: refundableAmount.toNumber(),
        currency: payload.data.currency,
        note: payload.data.note ?? null,
        created_by: access.userId,
      })
      .select(
        'id, retainer_no, case_id, client_id, responsible_user_id, contract_id, retainer_type, status, received_date, amount, used_amount, remaining_amount, refundable_amount, currency, note, created_at, updated_at',
      )
      .single();

    if (insertResult.error || !insertResult.data) {
      if (insertResult.error?.code === '23505') {
        return Response.json({ error: 'Avans numarasi cakisti. Tekrar deneyin.' }, { status: 409 });
      }
      return Response.json({ error: 'Avans olusturulamadi.' }, { status: 500 });
    }

    return Response.json({ item: mapRetainerRow(insertResult.data as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Avans servis hatasi.';
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
      return Response.json({ error: 'Gecersiz avans guncelleme verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTablesAvailable(admin);

    const currentResult = await admin
      .from('finance_retainers')
      .select(
        'id, case_id, client_id, responsible_user_id, contract_id, retainer_type, status, received_date, amount, used_amount, remaining_amount, refundable_amount, currency, note',
      )
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .maybeSingle();

    if (currentResult.error || !currentResult.data) {
      return Response.json({ error: 'Avans bulunamadi.' }, { status: 404 });
    }

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, payload.data.caseId ?? currentResult.data.case_id ?? null);

    let usedAmount = new Decimal(toNumber(currentResult.data.used_amount));
    let remainingAmount = new Decimal(toNumber(currentResult.data.remaining_amount));
    let nextStatus = (payload.data.status ?? currentResult.data.status) as FinanceRetainer['status'];

    if (payload.data.allocation) {
      const allocationAmount = new Decimal(payload.data.allocation.amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (allocationAmount.lte(0)) {
        return Response.json({ error: 'Mahsup tutari sifirdan buyuk olmali.' }, { status: 400 });
      }
      if (allocationAmount.gt(remainingAmount)) {
        return Response.json({ error: 'Mahsup tutari kalan avansi asamaz.' }, { status: 400 });
      }

      usedAmount = usedAmount.add(allocationAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      remainingAmount = remainingAmount.sub(allocationAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      nextStatus = deriveRetainerStatus({
        remainingAmount: remainingAmount.toNumber(),
        currentStatus: nextStatus,
      });

      const allocationInsert = await admin.from('finance_retainer_allocations').insert({
        bureau_id: access.bureauId,
        retainer_id: payload.data.id,
        case_id: payload.data.caseId ?? currentResult.data.case_id ?? null,
        client_id: payload.data.clientId ?? currentResult.data.client_id ?? null,
        invoice_id: payload.data.allocation.invoiceId ?? null,
        expense_id: payload.data.allocation.expenseId ?? null,
        payment_id: payload.data.allocation.paymentId ?? null,
        allocation_date: payload.data.allocation.allocationDate ?? utcDateOnly(new Date()),
        amount: allocationAmount.toNumber(),
        currency: payload.data.currency ?? currentResult.data.currency,
        note: payload.data.allocation.note ?? null,
        created_by: access.userId,
      });

      if (allocationInsert.error) {
        return Response.json({ error: 'Avans mahsup kaydi olusturulamadi.' }, { status: 500 });
      }
    }

    const updateResult = await admin
      .from('finance_retainers')
      .update({
        case_id: payload.data.caseId ?? currentResult.data.case_id,
        client_id: payload.data.clientId ?? currentResult.data.client_id,
        responsible_user_id: payload.data.responsibleUserId ?? currentResult.data.responsible_user_id,
        contract_id: payload.data.contractId ?? currentResult.data.contract_id,
        status: deriveRetainerStatus({
          remainingAmount: remainingAmount.toNumber(),
          currentStatus: nextStatus,
        }),
        received_date: payload.data.receivedDate ?? currentResult.data.received_date,
        used_amount: usedAmount.toNumber(),
        remaining_amount: remainingAmount.toNumber(),
        refundable_amount: payload.data.refundableAmount ?? currentResult.data.refundable_amount,
        currency: payload.data.currency ?? currentResult.data.currency,
        note: payload.data.note ?? currentResult.data.note,
      })
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .select(
        'id, retainer_no, case_id, client_id, responsible_user_id, contract_id, retainer_type, status, received_date, amount, used_amount, remaining_amount, refundable_amount, currency, note, created_at, updated_at',
      )
      .single();

    if (updateResult.error || !updateResult.data) {
      return Response.json({ error: 'Avans guncellenemedi.' }, { status: 500 });
    }

    return Response.json({ item: mapRetainerRow(updateResult.data as Record<string, unknown>) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Avans guncellenemedi.';
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
    await ensureTablesAvailable(admin);

    const deleteResult = await admin
      .from('finance_retainers')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    if (deleteResult.error || !deleteResult.data) {
      return Response.json({ error: 'Avans silinemedi.' }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Avans silinemedi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
