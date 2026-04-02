import Decimal from 'decimal.js';
import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import {
  assertCaseAccessible,
  mapTimeEntryRow,
  toNumber,
  utcDateOnly,
  type FinanceAccessContext,
} from '@/lib/dashboard/finance';
import type { FinanceListResponse, FinanceTimeEntry } from '@/types/finance-ops';

const querySchema = z.object({
  caseId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

const createSchema = z.object({
  caseId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  responsibleUserId: z.string().uuid().nullable().optional(),
  workType: z.enum(['hearing', 'petition', 'consulting', 'research', 'travel', 'waiting', 'other']),
  source: z.enum(['manual', 'timer']).default('manual'),
  workDate: z.string().date().optional(),
  durationMinutes: z.coerce.number().positive().max(1440),
  minBillingMinutes: z.coerce.number().int().min(0).max(480).default(0),
  roundingMinutes: z.coerce.number().int().min(1).max(120).default(6),
  billable: z.boolean().default(true),
  internalHourlyCost: z.coerce.number().min(0).max(1000000).default(0),
  salesHourlyRate: z.coerce.number().min(0).max(1000000).default(0),
  note: z.string().trim().max(2000).nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  endedAt: z.string().datetime().nullable().optional(),
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

function computeRoundedMinutes(durationMinutes: number, minBillingMinutes: number, roundingMinutes: number): number {
  const duration = new Decimal(durationMinutes);
  const minimum = Decimal.max(0, new Decimal(minBillingMinutes));
  const base = Decimal.max(duration, minimum);
  const step = Decimal.max(1, new Decimal(roundingMinutes));
  const rounded = base.div(step).ceil().mul(step);
  return rounded.toNumber();
}

function computeAmounts(input: {
  durationMinutes: number;
  roundedMinutes: number;
  billable: boolean;
  internalHourlyCost: number;
  salesHourlyRate: number;
}) {
  const laborHours = new Decimal(input.durationMinutes).div(60);
  const billableHours = new Decimal(input.roundedMinutes).div(60);

  const internalCostAmount = laborHours.mul(input.internalHourlyCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const billableAmount = input.billable
    ? billableHours.mul(input.salesHourlyRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : new Decimal(0);

  return {
    internalCostAmount: internalCostAmount.toNumber(),
    billableAmount: billableAmount.toNumber(),
  };
}

async function ensureTableAvailable(admin: ReturnType<typeof createAdminClient>) {
  const probe = await admin.from('finance_time_entries').select('id').limit(1);
  if (probe.error?.code === '42P01') {
    throw new Error('Finance tablolari hazir degil. rag_v2_step33_finance_ops_core.sql migrationini calistirin.');
  }
}

async function loadInvoiceLinks(
  admin: ReturnType<typeof createAdminClient>,
  timeEntryIds: string[],
): Promise<Map<string, string>> {
  if (timeEntryIds.length === 0) {
    return new Map();
  }

  const linksResult = await admin
    .from('finance_invoice_items')
    .select('time_entry_id, invoice_id')
    .in('time_entry_id', timeEntryIds)
    .is('deleted_at', null);

  if (linksResult.error) {
    return new Map();
  }

  const links = new Map<string, string>();
  ((linksResult.data ?? []) as Array<{ time_entry_id: string | null; invoice_id: string | null }>).forEach((row) => {
    if (!row.time_entry_id || !row.invoice_id) {
      return;
    }
    links.set(row.time_entry_id, row.invoice_id);
  });

  return links;
}

function buildAccessContext(input: { userId: string; role: FinanceAccessContext['role']; bureauId: string }): FinanceAccessContext {
  return {
    userId: input.userId,
    role: input.role,
    bureauId: input.bureauId,
  };
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
      dateFrom: params.get('dateFrom') ?? undefined,
      dateTo: params.get('dateTo') ?? undefined,
    });

    if (!parsed.success) {
      return Response.json({ error: 'Gecersiz filtre parametreleri.' }, { status: 400 });
    }

    const scope = buildAccessContext({
      userId: access.userId,
      role: access.role,
      bureauId: access.bureauId,
    });

    await assertCaseAccessible(admin, scope, parsed.data.caseId);

    let query = admin
      .from('finance_time_entries')
      .select(
        'id, case_id, client_id, responsible_user_id, work_type, source, work_date, duration_minutes, rounded_minutes, min_billing_minutes, rounding_minutes, billable, internal_hourly_cost, sales_hourly_rate, internal_cost_amount, billable_amount, currency, note, started_at, ended_at, created_at, updated_at',
      )
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(400);

    if (parsed.data.caseId) {
      query = query.eq('case_id', parsed.data.caseId);
    }
    if (parsed.data.clientId) {
      query = query.eq('client_id', parsed.data.clientId);
    }
    if (parsed.data.dateFrom) {
      query = query.gte('work_date', parsed.data.dateFrom);
    }
    if (parsed.data.dateTo) {
      query = query.lte('work_date', parsed.data.dateTo);
    }

    const result = await query;
    if (result.error) {
      return Response.json({ error: 'Sure kayitlari alinamadi.' }, { status: 500 });
    }

    const rows = (result.data ?? []) as Array<Record<string, unknown>>;
    const linksByEntryId = await loadInvoiceLinks(
      admin,
      rows.map((row) => String(row.id)),
    );

    const items: FinanceTimeEntry[] = rows.map((row) => {
      const mapped = mapTimeEntryRow({
        ...row,
        invoice_id: linksByEntryId.get(String(row.id)) ?? null,
      });
      return mapped;
    });

    const payload: FinanceListResponse<FinanceTimeEntry> = { items };
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sure kaydi servis hatasi.';
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
      return Response.json({ error: 'Gecersiz sure kaydi verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTableAvailable(admin);

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, payload.data.caseId ?? null);

    const roundedMinutes = computeRoundedMinutes(
      payload.data.durationMinutes,
      payload.data.minBillingMinutes,
      payload.data.roundingMinutes,
    );

    const amounts = computeAmounts({
      durationMinutes: payload.data.durationMinutes,
      roundedMinutes,
      billable: payload.data.billable,
      internalHourlyCost: payload.data.internalHourlyCost,
      salesHourlyRate: payload.data.salesHourlyRate,
    });

    const insertResult = await admin
      .from('finance_time_entries')
      .insert({
        bureau_id: access.bureauId,
        case_id: payload.data.caseId ?? null,
        client_id: payload.data.clientId ?? null,
        responsible_user_id: payload.data.responsibleUserId ?? access.userId,
        work_type: payload.data.workType,
        source: payload.data.source,
        work_date: payload.data.workDate ?? utcDateOnly(new Date()),
        duration_minutes: toNumber(payload.data.durationMinutes),
        rounded_minutes: roundedMinutes,
        min_billing_minutes: payload.data.minBillingMinutes,
        rounding_minutes: payload.data.roundingMinutes,
        billable: payload.data.billable,
        internal_hourly_cost: payload.data.internalHourlyCost,
        sales_hourly_rate: payload.data.salesHourlyRate,
        internal_cost_amount: amounts.internalCostAmount,
        billable_amount: amounts.billableAmount,
        currency: 'TRY',
        note: payload.data.note ?? null,
        started_at: payload.data.startedAt ?? null,
        ended_at: payload.data.endedAt ?? null,
        created_by: access.userId,
      })
      .select(
        'id, case_id, client_id, responsible_user_id, work_type, source, work_date, duration_minutes, rounded_minutes, min_billing_minutes, rounding_minutes, billable, internal_hourly_cost, sales_hourly_rate, internal_cost_amount, billable_amount, currency, note, started_at, ended_at, created_at, updated_at',
      )
      .single();

    if (insertResult.error || !insertResult.data) {
      return Response.json({ error: 'Sure kaydi olusturulamadi.' }, { status: 500 });
    }

    return Response.json({ item: mapTimeEntryRow(insertResult.data as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sure kaydi servis hatasi.';
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
      return Response.json({ error: 'Gecersiz guncelleme verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTableAvailable(admin);

    const currentResult = await admin
      .from('finance_time_entries')
      .select(
        'id, bureau_id, case_id, client_id, responsible_user_id, work_type, source, work_date, duration_minutes, rounded_minutes, min_billing_minutes, rounding_minutes, billable, internal_hourly_cost, sales_hourly_rate, internal_cost_amount, billable_amount, currency, note, started_at, ended_at, created_at, updated_at',
      )
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .maybeSingle();

    if (currentResult.error || !currentResult.data) {
      return Response.json({ error: 'Sure kaydi bulunamadi.' }, { status: 404 });
    }

    const next = {
      caseId: payload.data.caseId ?? currentResult.data.case_id,
      clientId: payload.data.clientId ?? currentResult.data.client_id,
      responsibleUserId: payload.data.responsibleUserId ?? currentResult.data.responsible_user_id,
      workType: payload.data.workType ?? currentResult.data.work_type,
      source: payload.data.source ?? currentResult.data.source,
      workDate: payload.data.workDate ?? currentResult.data.work_date,
      durationMinutes: payload.data.durationMinutes ?? toNumber(currentResult.data.duration_minutes),
      minBillingMinutes: payload.data.minBillingMinutes ?? toNumber(currentResult.data.min_billing_minutes),
      roundingMinutes: payload.data.roundingMinutes ?? toNumber(currentResult.data.rounding_minutes),
      billable: payload.data.billable ?? Boolean(currentResult.data.billable),
      internalHourlyCost: payload.data.internalHourlyCost ?? toNumber(currentResult.data.internal_hourly_cost),
      salesHourlyRate: payload.data.salesHourlyRate ?? toNumber(currentResult.data.sales_hourly_rate),
      note: payload.data.note ?? (currentResult.data.note as string | null),
      startedAt: payload.data.startedAt ?? (currentResult.data.started_at as string | null),
      endedAt: payload.data.endedAt ?? (currentResult.data.ended_at as string | null),
    };

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, next.caseId ?? null);

    const roundedMinutes = computeRoundedMinutes(next.durationMinutes, next.minBillingMinutes, next.roundingMinutes);
    const amounts = computeAmounts({
      durationMinutes: next.durationMinutes,
      roundedMinutes,
      billable: next.billable,
      internalHourlyCost: next.internalHourlyCost,
      salesHourlyRate: next.salesHourlyRate,
    });

    const updateResult = await admin
      .from('finance_time_entries')
      .update({
        case_id: next.caseId,
        client_id: next.clientId,
        responsible_user_id: next.responsibleUserId,
        work_type: next.workType,
        source: next.source,
        work_date: next.workDate,
        duration_minutes: next.durationMinutes,
        rounded_minutes: roundedMinutes,
        min_billing_minutes: next.minBillingMinutes,
        rounding_minutes: next.roundingMinutes,
        billable: next.billable,
        internal_hourly_cost: next.internalHourlyCost,
        sales_hourly_rate: next.salesHourlyRate,
        internal_cost_amount: amounts.internalCostAmount,
        billable_amount: amounts.billableAmount,
        note: next.note,
        started_at: next.startedAt,
        ended_at: next.endedAt,
      })
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .select(
        'id, case_id, client_id, responsible_user_id, work_type, source, work_date, duration_minutes, rounded_minutes, min_billing_minutes, rounding_minutes, billable, internal_hourly_cost, sales_hourly_rate, internal_cost_amount, billable_amount, currency, note, started_at, ended_at, created_at, updated_at',
      )
      .single();

    if (updateResult.error || !updateResult.data) {
      return Response.json({ error: 'Sure kaydi guncellenemedi.' }, { status: 500 });
    }

    return Response.json({ item: mapTimeEntryRow(updateResult.data as Record<string, unknown>) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sure kaydi guncellenemedi.';
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
      .from('finance_time_entries')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    if (deleteResult.error || !deleteResult.data) {
      return Response.json({ error: 'Sure kaydi silinemedi.' }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sure kaydi silinemedi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
