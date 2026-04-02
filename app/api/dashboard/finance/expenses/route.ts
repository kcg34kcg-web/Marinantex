import Decimal from 'decimal.js';
import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import {
  assertCaseAccessible,
  mapExpenseRow,
  toNumber,
  utcDateOnly,
  type FinanceAccessContext,
} from '@/lib/dashboard/finance';
import type { FinanceExpense, FinanceListResponse } from '@/types/finance-ops';

const querySchema = z.object({
  caseId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  category: z
    .enum([
      'harc',
      'tebligat',
      'bilirkisi',
      'kesif',
      'uyap_noter_baro',
      'travel_accommodation',
      'courier_post',
      'translation',
      'office_expense',
      'external_consultant',
      'other',
    ])
    .optional(),
});

const createSchema = z.object({
  caseId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  responsibleUserId: z.string().uuid().nullable().optional(),
  category: z.enum([
    'harc',
    'tebligat',
    'bilirkisi',
    'kesif',
    'uyap_noter_baro',
    'travel_accommodation',
    'courier_post',
    'translation',
    'office_expense',
    'external_consultant',
    'other',
  ]),
  expenseDate: z.string().date().optional(),
  amount: z.coerce.number().positive().max(100000000),
  currency: z.string().trim().min(3).max(8).default('TRY'),
  description: z.string().trim().max(2000).nullable().optional(),
  documentNo: z.string().trim().max(120).nullable().optional(),
  documentDate: z.string().date().nullable().optional(),
  supplierName: z.string().trim().max(200).nullable().optional(),
  vatRate: z.coerce.number().min(0).max(100).default(20),
  vatIncluded: z.boolean().default(true),
  billableToClient: z.boolean().default(true),
  coveredByRetainer: z.boolean().default(false),
  receiptPath: z.string().trim().max(512).nullable().optional(),
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

function computeVatBreakdown(input: { amount: number; vatRate: number; vatIncluded: boolean }) {
  const amount = new Decimal(input.amount);
  const vatRateRatio = new Decimal(input.vatRate).div(100);

  if (input.vatIncluded) {
    if (vatRateRatio.eq(0)) {
      return {
        netAmount: amount.toNumber(),
        vatAmount: 0,
        grossAmount: amount.toNumber(),
      };
    }

    const net = amount.div(vatRateRatio.add(1)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const vat = amount.sub(net).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    return {
      netAmount: net.toNumber(),
      vatAmount: vat.toNumber(),
      grossAmount: amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    };
  }

  const vat = amount.mul(vatRateRatio).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const gross = amount.add(vat).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    netAmount: amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    vatAmount: vat.toNumber(),
    grossAmount: gross.toNumber(),
  };
}

async function ensureTableAvailable(admin: ReturnType<typeof createAdminClient>) {
  const probe = await admin.from('finance_expenses').select('id').limit(1);
  if (probe.error?.code === '42P01') {
    throw new Error('Finance tablolari hazir degil. rag_v2_step33_finance_ops_core.sql migrationini calistirin.');
  }
}

async function loadInvoiceLinks(
  admin: ReturnType<typeof createAdminClient>,
  expenseIds: string[],
): Promise<Map<string, string>> {
  if (expenseIds.length === 0) {
    return new Map();
  }

  const linksResult = await admin
    .from('finance_invoice_items')
    .select('expense_id, invoice_id')
    .in('expense_id', expenseIds)
    .is('deleted_at', null);

  if (linksResult.error) {
    return new Map();
  }

  const links = new Map<string, string>();
  ((linksResult.data ?? []) as Array<{ expense_id: string | null; invoice_id: string | null }>).forEach((row) => {
    if (!row.expense_id || !row.invoice_id) {
      return;
    }
    links.set(row.expense_id, row.invoice_id);
  });

  return links;
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
      category: params.get('category') ?? undefined,
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
      .from('finance_expenses')
      .select(
        'id, case_id, client_id, responsible_user_id, category, expense_date, amount, currency, description, document_no, document_date, supplier_name, vat_rate, vat_included, vat_amount, net_amount, gross_amount, billable_to_client, covered_by_retainer, receipt_path, created_at, updated_at',
      )
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(400);

    if (parsed.data.caseId) {
      query = query.eq('case_id', parsed.data.caseId);
    }
    if (parsed.data.clientId) {
      query = query.eq('client_id', parsed.data.clientId);
    }
    if (parsed.data.dateFrom) {
      query = query.gte('expense_date', parsed.data.dateFrom);
    }
    if (parsed.data.dateTo) {
      query = query.lte('expense_date', parsed.data.dateTo);
    }
    if (parsed.data.category) {
      query = query.eq('category', parsed.data.category);
    }

    const result = await query;
    if (result.error) {
      return Response.json({ error: 'Masraf kayitlari alinamadi.' }, { status: 500 });
    }

    const rows = (result.data ?? []) as Array<Record<string, unknown>>;
    const linksByExpenseId = await loadInvoiceLinks(
      admin,
      rows.map((row) => String(row.id)),
    );

    const items: FinanceExpense[] = rows.map((row) =>
      mapExpenseRow({
        ...row,
        invoice_id: linksByExpenseId.get(String(row.id)) ?? null,
      }),
    );

    const payload: FinanceListResponse<FinanceExpense> = { items };
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Masraf servis hatasi.';
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
      return Response.json({ error: 'Gecersiz masraf verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTableAvailable(admin);

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, payload.data.caseId ?? null);

    const vat = computeVatBreakdown({
      amount: payload.data.amount,
      vatRate: payload.data.vatRate,
      vatIncluded: payload.data.vatIncluded,
    });

    const insertResult = await admin
      .from('finance_expenses')
      .insert({
        bureau_id: access.bureauId,
        case_id: payload.data.caseId ?? null,
        client_id: payload.data.clientId ?? null,
        responsible_user_id: payload.data.responsibleUserId ?? access.userId,
        category: payload.data.category,
        expense_date: payload.data.expenseDate ?? utcDateOnly(new Date()),
        amount: payload.data.amount,
        currency: payload.data.currency,
        description: payload.data.description ?? null,
        document_no: payload.data.documentNo ?? null,
        document_date: payload.data.documentDate ?? null,
        supplier_name: payload.data.supplierName ?? null,
        vat_rate: payload.data.vatRate,
        vat_included: payload.data.vatIncluded,
        vat_amount: vat.vatAmount,
        net_amount: vat.netAmount,
        gross_amount: vat.grossAmount,
        billable_to_client: payload.data.billableToClient,
        covered_by_retainer: payload.data.coveredByRetainer,
        receipt_path: payload.data.receiptPath ?? null,
        created_by: access.userId,
      })
      .select(
        'id, case_id, client_id, responsible_user_id, category, expense_date, amount, currency, description, document_no, document_date, supplier_name, vat_rate, vat_included, vat_amount, net_amount, gross_amount, billable_to_client, covered_by_retainer, receipt_path, created_at, updated_at',
      )
      .single();

    if (insertResult.error || !insertResult.data) {
      return Response.json({ error: 'Masraf kaydi olusturulamadi.' }, { status: 500 });
    }

    return Response.json({ item: mapExpenseRow(insertResult.data as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Masraf servis hatasi.';
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
      .from('finance_expenses')
      .select(
        'id, bureau_id, case_id, client_id, responsible_user_id, category, expense_date, amount, currency, description, document_no, document_date, supplier_name, vat_rate, vat_included, vat_amount, net_amount, gross_amount, billable_to_client, covered_by_retainer, receipt_path, created_at, updated_at',
      )
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .maybeSingle();

    if (currentResult.error || !currentResult.data) {
      return Response.json({ error: 'Masraf kaydi bulunamadi.' }, { status: 404 });
    }

    const next = {
      caseId: payload.data.caseId ?? currentResult.data.case_id,
      clientId: payload.data.clientId ?? currentResult.data.client_id,
      responsibleUserId: payload.data.responsibleUserId ?? currentResult.data.responsible_user_id,
      category: payload.data.category ?? currentResult.data.category,
      expenseDate: payload.data.expenseDate ?? currentResult.data.expense_date,
      amount: payload.data.amount ?? toNumber(currentResult.data.amount),
      currency: payload.data.currency ?? String(currentResult.data.currency ?? 'TRY'),
      description: payload.data.description ?? (currentResult.data.description as string | null),
      documentNo: payload.data.documentNo ?? (currentResult.data.document_no as string | null),
      documentDate: payload.data.documentDate ?? (currentResult.data.document_date as string | null),
      supplierName: payload.data.supplierName ?? (currentResult.data.supplier_name as string | null),
      vatRate: payload.data.vatRate ?? toNumber(currentResult.data.vat_rate),
      vatIncluded: payload.data.vatIncluded ?? Boolean(currentResult.data.vat_included),
      billableToClient: payload.data.billableToClient ?? Boolean(currentResult.data.billable_to_client),
      coveredByRetainer: payload.data.coveredByRetainer ?? Boolean(currentResult.data.covered_by_retainer),
      receiptPath: payload.data.receiptPath ?? (currentResult.data.receipt_path as string | null),
    };

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, next.caseId ?? null);

    const vat = computeVatBreakdown({
      amount: next.amount,
      vatRate: next.vatRate,
      vatIncluded: next.vatIncluded,
    });

    const updateResult = await admin
      .from('finance_expenses')
      .update({
        case_id: next.caseId,
        client_id: next.clientId,
        responsible_user_id: next.responsibleUserId,
        category: next.category,
        expense_date: next.expenseDate,
        amount: next.amount,
        currency: next.currency,
        description: next.description,
        document_no: next.documentNo,
        document_date: next.documentDate,
        supplier_name: next.supplierName,
        vat_rate: next.vatRate,
        vat_included: next.vatIncluded,
        vat_amount: vat.vatAmount,
        net_amount: vat.netAmount,
        gross_amount: vat.grossAmount,
        billable_to_client: next.billableToClient,
        covered_by_retainer: next.coveredByRetainer,
        receipt_path: next.receiptPath,
      })
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .select(
        'id, case_id, client_id, responsible_user_id, category, expense_date, amount, currency, description, document_no, document_date, supplier_name, vat_rate, vat_included, vat_amount, net_amount, gross_amount, billable_to_client, covered_by_retainer, receipt_path, created_at, updated_at',
      )
      .single();

    if (updateResult.error || !updateResult.data) {
      return Response.json({ error: 'Masraf kaydi guncellenemedi.' }, { status: 500 });
    }

    return Response.json({ item: mapExpenseRow(updateResult.data as Record<string, unknown>) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Masraf kaydi guncellenemedi.';
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
      .from('finance_expenses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    if (deleteResult.error || !deleteResult.data) {
      return Response.json({ error: 'Masraf kaydi silinemedi.' }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Masraf kaydi silinemedi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
