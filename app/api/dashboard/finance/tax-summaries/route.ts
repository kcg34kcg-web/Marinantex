import Decimal from 'decimal.js';
import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { mapTaxSummaryRow, toMoneyFixed, toNumber } from '@/lib/dashboard/finance';
import type { FinanceListResponse, FinanceTaxSummary } from '@/types/finance-ops';

const querySchema = z.object({
  periodType: z.enum(['monthly', 'quarterly', 'yearly']).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

const createSchema = z.object({
  periodType: z.enum(['monthly', 'quarterly', 'yearly']),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  currency: z.string().trim().min(3).max(8).default('TRY'),
});

async function ensureTablesAvailable(admin: ReturnType<typeof createAdminClient>) {
  const [summaryProbe, invoiceProbe, expenseProbe, timeProbe] = await Promise.all([
    admin.from('finance_tax_summaries').select('id').limit(1),
    admin.from('finance_invoices').select('id').limit(1),
    admin.from('finance_expenses').select('id').limit(1),
    admin.from('finance_time_entries').select('id').limit(1),
  ]);

  if (
    summaryProbe.error?.code === '42P01' ||
    invoiceProbe.error?.code === '42P01' ||
    expenseProbe.error?.code === '42P01' ||
    timeProbe.error?.code === '42P01'
  ) {
    throw new Error('Finance tablolari hazir degil. rag_v2_step33_finance_ops_core.sql migrationini calistirin.');
  }
}

function normalizePeriod(payload: z.infer<typeof createSchema>) {
  if (payload.periodStart > payload.periodEnd) {
    throw new Error('Donem baslangici donem bitisinden sonra olamaz.');
  }

  return {
    periodType: payload.periodType,
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
    currency: payload.currency,
  };
}

async function computeAndPersistSummary(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    bureauId: string;
    userId: string;
    periodType: 'monthly' | 'quarterly' | 'yearly';
    periodStart: string;
    periodEnd: string;
    currency: string;
  },
): Promise<FinanceTaxSummary> {
  const [invoicesResult, expensesResult, timeEntriesResult, taxConfigResult] = await Promise.all([
    admin
      .from('finance_invoices')
      .select('total_amount, vat_total, withholding_total')
      .eq('bureau_id', input.bureauId)
      .is('deleted_at', null)
      .gte('invoice_date', input.periodStart)
      .lte('invoice_date', input.periodEnd),
    admin
      .from('finance_expenses')
      .select('gross_amount, vat_amount')
      .eq('bureau_id', input.bureauId)
      .is('deleted_at', null)
      .gte('expense_date', input.periodStart)
      .lte('expense_date', input.periodEnd),
    admin
      .from('finance_time_entries')
      .select('internal_cost_amount')
      .eq('bureau_id', input.bureauId)
      .is('deleted_at', null)
      .gte('work_date', input.periodStart)
      .lte('work_date', input.periodEnd),
    admin
      .from('finance_tax_configs')
      .select('estimated_income_tax_rate')
      .eq('bureau_id', input.bureauId)
      .maybeSingle(),
  ]);

  if (invoicesResult.error || expensesResult.error || timeEntriesResult.error) {
    throw new Error('Vergi ozeti icin gerekli veriler hesaplanamadi.');
  }

  const outputVat = ((invoicesResult.data ?? []) as Array<{ vat_total: number }>).reduce(
    (sum, row) => sum.add(toNumber(row.vat_total)),
    new Decimal(0),
  );
  const deductibleVat = ((expensesResult.data ?? []) as Array<{ vat_amount: number }>).reduce(
    (sum, row) => sum.add(toNumber(row.vat_amount)),
    new Decimal(0),
  );
  const netVatPosition = outputVat.sub(deductibleVat).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const withholdingTotal = ((invoicesResult.data ?? []) as Array<{ withholding_total: number }>).reduce(
    (sum, row) => sum.add(toNumber(row.withholding_total)),
    new Decimal(0),
  );

  const accrualRevenue = ((invoicesResult.data ?? []) as Array<{ total_amount: number }>).reduce(
    (sum, row) => sum.add(toNumber(row.total_amount)),
    new Decimal(0),
  );
  const directExpense = ((expensesResult.data ?? []) as Array<{ gross_amount: number }>).reduce(
    (sum, row) => sum.add(toNumber(row.gross_amount)),
    new Decimal(0),
  );
  const laborCost = ((timeEntriesResult.data ?? []) as Array<{ internal_cost_amount: number }>).reduce(
    (sum, row) => sum.add(toNumber(row.internal_cost_amount)),
    new Decimal(0),
  );

  const grossProfit = accrualRevenue.sub(directExpense).sub(laborCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const estimatedIncomeTaxRate = new Decimal(toNumber(taxConfigResult.data?.estimated_income_tax_rate ?? 25));
  const estimatedIncomeTax = Decimal.max(grossProfit, 0)
    .mul(estimatedIncomeTaxRate)
    .div(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const netProfitAfterTax = grossProfit
    .sub(estimatedIncomeTax)
    .sub(Decimal.max(netVatPosition, 0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const upsertResult = await admin
    .from('finance_tax_summaries')
    .upsert(
      {
        bureau_id: input.bureauId,
        period_type: input.periodType,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        output_vat: toMoneyFixed(outputVat),
        deductible_vat: toMoneyFixed(deductibleVat),
        net_vat_position: toMoneyFixed(netVatPosition),
        withholding_total: toMoneyFixed(withholdingTotal),
        estimated_income_tax: toMoneyFixed(estimatedIncomeTax),
        gross_profit: toMoneyFixed(grossProfit),
        net_profit_after_tax: toMoneyFixed(netProfitAfterTax),
        currency: input.currency,
        snapshot_payload: {
          accrualRevenue: toNumber(accrualRevenue),
          directExpense: toNumber(directExpense),
          laborCost: toNumber(laborCost),
          estimatedIncomeTaxRate: toNumber(estimatedIncomeTaxRate),
        },
        generated_by: input.userId,
        generated_at: new Date().toISOString(),
      },
      {
        onConflict: 'bureau_id,period_type,period_start,period_end',
      },
    )
    .select(
      'id, period_type, period_start, period_end, output_vat, deductible_vat, net_vat_position, withholding_total, estimated_income_tax, gross_profit, net_profit_after_tax, currency, generated_at',
    )
    .single();

  if (upsertResult.error || !upsertResult.data) {
    throw new Error('Vergi ozeti kaydedilemedi.');
  }

  return mapTaxSummaryRow(upsertResult.data as Record<string, unknown>);
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
      periodType: params.get('periodType') ?? undefined,
      dateFrom: params.get('dateFrom') ?? undefined,
      dateTo: params.get('dateTo') ?? undefined,
    });

    if (!parsed.success) {
      return Response.json({ error: 'Gecersiz filtre parametreleri.' }, { status: 400 });
    }

    let query = admin
      .from('finance_tax_summaries')
      .select(
        'id, period_type, period_start, period_end, output_vat, deductible_vat, net_vat_position, withholding_total, estimated_income_tax, gross_profit, net_profit_after_tax, currency, generated_at',
      )
      .eq('bureau_id', access.bureauId)
      .order('period_start', { ascending: false })
      .limit(120);

    if (parsed.data.periodType) {
      query = query.eq('period_type', parsed.data.periodType);
    }
    if (parsed.data.dateFrom) {
      query = query.gte('period_start', parsed.data.dateFrom);
    }
    if (parsed.data.dateTo) {
      query = query.lte('period_end', parsed.data.dateTo);
    }

    const result = await query;
    if (result.error) {
      return Response.json({ error: 'Vergi ozetleri alinamadi.' }, { status: 500 });
    }

    const items: FinanceTaxSummary[] = ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => mapTaxSummaryRow(row));
    const payload: FinanceListResponse<FinanceTaxSummary> = { items };
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vergi ozetleri alinamadi.';
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
      return Response.json({ error: 'Gecersiz vergi ozet istegi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTablesAvailable(admin);

    const normalized = normalizePeriod(payload.data);
    const item = await computeAndPersistSummary(admin, {
      bureauId: access.bureauId,
      userId: access.userId,
      periodType: normalized.periodType,
      periodStart: normalized.periodStart,
      periodEnd: normalized.periodEnd,
      currency: normalized.currency,
    });

    return Response.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vergi ozeti olusturulamadi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
