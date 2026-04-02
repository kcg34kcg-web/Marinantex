import Decimal from 'decimal.js';
import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import {
  assertCaseAccessible,
  createSequenceCode,
  mapInvoiceRow,
  toNumber,
  utcDateOnly,
  type FinanceAccessContext,
} from '@/lib/dashboard/finance';
import type { FinanceInvoice, FinanceListResponse } from '@/types/finance-ops';

const querySchema = z.object({
  caseId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  status: z.enum(['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled']).optional(),
});

const createSchema = z.object({
  caseId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  responsibleUserId: z.string().uuid().nullable().optional(),
  proposalId: z.string().uuid().nullable().optional(),
  contractId: z.string().uuid().nullable().optional(),
  billingModel: z.enum(['hourly', 'fixed_fee', 'success_fee', 'retainer', 'mixed']).default('hourly'),
  invoiceDate: z.string().date().optional(),
  dueDate: z.string().date().nullable().optional(),
  currency: z.string().trim().min(3).max(8).default('TRY'),
  vatRate: z.coerce.number().min(0).max(100).default(20),
  withholdingRate: z.coerce.number().min(0).max(100).default(0),
  discountTotal: z.coerce.number().min(0).max(100000000).default(0),
  description: z.string().trim().max(2000).nullable().optional(),
  autoIncludeUnbilledTime: z.boolean().default(true),
  autoIncludeUnbilledExpenses: z.boolean().default(true),
  manualAmount: z.coerce.number().min(0).max(100000000).optional(),
  manualItemDescription: z.string().trim().max(300).optional(),
  status: z.enum(['draft', 'issued']).default('issued'),
});

const updateSchema = z
  .object({
    id: z.string().uuid(),
    dueDate: z.string().date().nullable().optional(),
    status: z.enum(['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled']).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    reminderNote: z.string().trim().max(1000).nullable().optional(),
    recordReminder: z.boolean().optional(),
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

async function ensureTablesAvailable(admin: ReturnType<typeof createAdminClient>) {
  const [invoiceProbe, itemProbe] = await Promise.all([
    admin.from('finance_invoices').select('id').limit(1),
    admin.from('finance_invoice_items').select('id').limit(1),
  ]);

  if (invoiceProbe.error?.code === '42P01' || itemProbe.error?.code === '42P01') {
    throw new Error('Finance tablolari hazir degil. rag_v2_step33_finance_ops_core.sql migrationini calistirin.');
  }
}

async function resolveUnbilledTimeEntries(
  admin: ReturnType<typeof createAdminClient>,
  input: { bureauId: string; caseId: string | null; clientId: string | null },
): Promise<Array<{ id: string; case_id: string | null; client_id: string | null; billable_amount: number; rounded_minutes: number; sales_hourly_rate: number; note: string | null }>> {
  let query = admin
    .from('finance_time_entries')
    .select('id, case_id, client_id, billable_amount, rounded_minutes, sales_hourly_rate, note')
    .eq('bureau_id', input.bureauId)
    .eq('billable', true)
    .is('deleted_at', null)
    .limit(1000);

  if (input.caseId) {
    query = query.eq('case_id', input.caseId);
  }

  if (input.clientId) {
    query = query.eq('client_id', input.clientId);
  }

  const result = await query;
  if (result.error) {
    return [];
  }

  const rows = (result.data ?? []) as Array<{
    id: string;
    case_id: string | null;
    client_id: string | null;
    billable_amount: number;
    rounded_minutes: number;
    sales_hourly_rate: number;
    note: string | null;
  }>;

  if (rows.length === 0) {
    return [];
  }

  const invoicedResult = await admin
    .from('finance_invoice_items')
    .select('time_entry_id')
    .in(
      'time_entry_id',
      rows.map((row) => row.id),
    )
    .is('deleted_at', null);

  const invoicedIds = new Set(
    ((invoicedResult.data ?? []) as Array<{ time_entry_id: string | null }>)
      .map((row) => row.time_entry_id)
      .filter((value): value is string => Boolean(value)),
  );

  return rows.filter((row) => !invoicedIds.has(row.id));
}

async function resolveUnbilledExpenses(
  admin: ReturnType<typeof createAdminClient>,
  input: { bureauId: string; caseId: string | null; clientId: string | null },
): Promise<Array<{ id: string; case_id: string | null; client_id: string | null; gross_amount: number; description: string | null }>> {
  let query = admin
    .from('finance_expenses')
    .select('id, case_id, client_id, gross_amount, description')
    .eq('bureau_id', input.bureauId)
    .eq('billable_to_client', true)
    .is('deleted_at', null)
    .limit(1000);

  if (input.caseId) {
    query = query.eq('case_id', input.caseId);
  }

  if (input.clientId) {
    query = query.eq('client_id', input.clientId);
  }

  const result = await query;
  if (result.error) {
    return [];
  }

  const rows = (result.data ?? []) as Array<{
    id: string;
    case_id: string | null;
    client_id: string | null;
    gross_amount: number;
    description: string | null;
  }>;

  if (rows.length === 0) {
    return [];
  }

  const invoicedResult = await admin
    .from('finance_invoice_items')
    .select('expense_id')
    .in(
      'expense_id',
      rows.map((row) => row.id),
    )
    .is('deleted_at', null);

  const invoicedIds = new Set(
    ((invoicedResult.data ?? []) as Array<{ expense_id: string | null }>)
      .map((row) => row.expense_id)
      .filter((value): value is string => Boolean(value)),
  );

  return rows.filter((row) => !invoicedIds.has(row.id));
}

function recalculateStatus(row: FinanceInvoice): FinanceInvoice {
  if (row.status === 'paid' || row.status === 'cancelled') {
    return row;
  }

  if (row.amountDue <= 0) {
    return {
      ...row,
      status: 'paid',
    };
  }

  if (row.amountPaid > 0 && row.amountDue > 0) {
    return {
      ...row,
      status: 'partially_paid',
    };
  }

  if (row.dueDate) {
    const dueAt = new Date(`${row.dueDate}T23:59:59Z`);
    if (!Number.isNaN(dueAt.getTime()) && dueAt.getTime() < Date.now()) {
      return {
        ...row,
        status: 'overdue',
      };
    }
  }

  return row;
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
      .from('finance_invoices')
      .select(
        'id, invoice_no, case_id, client_id, responsible_user_id, proposal_id, contract_id, billing_model, invoice_date, due_date, status, currency, subtotal, discount_total, vat_rate, vat_total, withholding_rate, withholding_total, total_amount, amount_paid, amount_due, description, last_reminder_at, reminder_note, created_at, updated_at',
      )
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .order('invoice_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(400);

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
      return Response.json({ error: 'Fatura listesi alinamadi.' }, { status: 500 });
    }

    const items = ((result.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => mapInvoiceRow(row))
      .map((row) => recalculateStatus(row));

    const payload: FinanceListResponse<FinanceInvoice> = { items };
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fatura servis hatasi.';
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
      return Response.json({ error: 'Gecersiz fatura verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTablesAvailable(admin);

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, payload.data.caseId ?? null);

    const [timeRows, expenseRows] = await Promise.all([
      payload.data.autoIncludeUnbilledTime
        ? resolveUnbilledTimeEntries(admin, {
            bureauId: access.bureauId,
            caseId: payload.data.caseId ?? null,
            clientId: payload.data.clientId ?? null,
          })
        : Promise.resolve([]),
      payload.data.autoIncludeUnbilledExpenses
        ? resolveUnbilledExpenses(admin, {
            bureauId: access.bureauId,
            caseId: payload.data.caseId ?? null,
            clientId: payload.data.clientId ?? null,
          })
        : Promise.resolve([]),
    ]);

    const manualAmount = payload.data.manualAmount ?? 0;
    const manualItemDescription = payload.data.manualItemDescription?.trim() || 'Manuel fatura kalemi';

    const itemRows: Array<{
      itemType: 'time_entry' | 'expense' | 'manual';
      caseId: string | null;
      clientId: string | null;
      timeEntryId: string | null;
      expenseId: string | null;
      description: string;
      quantity: number;
      unitPrice: number;
      lineSubtotal: number;
    }> = [];

    timeRows.forEach((row) => {
      const subtotal = toNumber(row.billable_amount);
      if (subtotal <= 0) {
        return;
      }

      itemRows.push({
        itemType: 'time_entry',
        caseId: row.case_id,
        clientId: row.client_id,
        timeEntryId: row.id,
        expenseId: null,
        description: row.note?.trim() || 'Faturalanabilir sure kalemi',
        quantity: new Decimal(toNumber(row.rounded_minutes)).div(60).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
        unitPrice: toNumber(row.sales_hourly_rate),
        lineSubtotal: subtotal,
      });
    });

    expenseRows.forEach((row) => {
      const subtotal = toNumber(row.gross_amount);
      if (subtotal <= 0) {
        return;
      }

      itemRows.push({
        itemType: 'expense',
        caseId: row.case_id,
        clientId: row.client_id,
        timeEntryId: null,
        expenseId: row.id,
        description: row.description?.trim() || 'Masraf yansitma kalemi',
        quantity: 1,
        unitPrice: subtotal,
        lineSubtotal: subtotal,
      });
    });

    if (manualAmount > 0) {
      itemRows.push({
        itemType: 'manual',
        caseId: payload.data.caseId ?? null,
        clientId: payload.data.clientId ?? null,
        timeEntryId: null,
        expenseId: null,
        description: manualItemDescription,
        quantity: 1,
        unitPrice: manualAmount,
        lineSubtotal: manualAmount,
      });
    }

    if (itemRows.length === 0) {
      return Response.json({ error: 'Fatura kalemi olusturulamadi. En az bir kalem gerekir.' }, { status: 400 });
    }

    const subtotal = itemRows.reduce((sum, item) => sum.add(item.lineSubtotal), new Decimal(0));
    const discount = new Decimal(payload.data.discountTotal);
    const taxableBase = Decimal.max(subtotal.sub(discount), 0);
    const vatTotal = taxableBase.mul(payload.data.vatRate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const withholdingTotal = taxableBase
      .mul(payload.data.withholdingRate)
      .div(100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const totalAmount = taxableBase.add(vatTotal).sub(withholdingTotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const invoiceNo = createSequenceCode('INV');
    const invoiceDate = payload.data.invoiceDate ?? utcDateOnly(new Date());

    const invoiceInsert = await admin
      .from('finance_invoices')
      .insert({
        bureau_id: access.bureauId,
        invoice_no: invoiceNo,
        case_id: payload.data.caseId ?? null,
        client_id: payload.data.clientId ?? null,
        responsible_user_id: payload.data.responsibleUserId ?? access.userId,
        proposal_id: payload.data.proposalId ?? null,
        contract_id: payload.data.contractId ?? null,
        billing_model: payload.data.billingModel,
        invoice_date: invoiceDate,
        due_date: payload.data.dueDate ?? null,
        currency: payload.data.currency,
        status: payload.data.status,
        subtotal: subtotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
        discount_total: discount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
        vat_rate: payload.data.vatRate,
        vat_total: vatTotal.toNumber(),
        withholding_rate: payload.data.withholdingRate,
        withholding_total: withholdingTotal.toNumber(),
        total_amount: totalAmount.toNumber(),
        amount_paid: 0,
        amount_due: totalAmount.toNumber(),
        description: payload.data.description ?? null,
        created_by: access.userId,
      })
      .select(
        'id, invoice_no, case_id, client_id, responsible_user_id, proposal_id, contract_id, billing_model, invoice_date, due_date, status, currency, subtotal, discount_total, vat_rate, vat_total, withholding_rate, withholding_total, total_amount, amount_paid, amount_due, description, last_reminder_at, reminder_note, created_at, updated_at',
      )
      .single();

    if (invoiceInsert.error || !invoiceInsert.data) {
      if (invoiceInsert.error?.code === '23505') {
        return Response.json({ error: 'Fatura numarasi cakisti. Tekrar deneyin.' }, { status: 409 });
      }
      return Response.json({ error: 'Fatura olusturulamadi.' }, { status: 500 });
    }

    const invoiceId = invoiceInsert.data.id;

    const invoiceItemsInsert = await admin.from('finance_invoice_items').insert(
      itemRows.map((item) => ({
        bureau_id: access.bureauId,
        invoice_id: invoiceId,
        case_id: item.caseId,
        client_id: item.clientId,
        item_type: item.itemType,
        time_entry_id: item.timeEntryId,
        expense_id: item.expenseId,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount_rate: 0,
        tax_rate: payload.data.vatRate,
        withholding_rate: payload.data.withholdingRate,
        line_subtotal: item.lineSubtotal,
        line_discount: 0,
        line_vat: new Decimal(item.lineSubtotal).mul(payload.data.vatRate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
        line_withholding: new Decimal(item.lineSubtotal)
          .mul(payload.data.withholdingRate)
          .div(100)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          .toNumber(),
        line_total: new Decimal(item.lineSubtotal)
          .mul(new Decimal(1).add(new Decimal(payload.data.vatRate).div(100)))
          .sub(new Decimal(item.lineSubtotal).mul(payload.data.withholdingRate).div(100))
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          .toNumber(),
        created_by: access.userId,
      })),
    );

    if (invoiceItemsInsert.error) {
      await admin.from('finance_invoices').update({ deleted_at: new Date().toISOString() }).eq('id', invoiceId);
      return Response.json({ error: 'Fatura kalemleri kaydedilemedi.' }, { status: 500 });
    }

    if (timeRows.length > 0) {
      await admin
        .from('finance_time_entries')
        .update({ status: 'billed' })
        .in(
          'id',
          timeRows.map((row) => row.id),
        )
        .eq('bureau_id', access.bureauId)
        .is('deleted_at', null);
    }

    return Response.json({ item: mapInvoiceRow(invoiceInsert.data as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fatura servis hatasi.';
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
      return Response.json({ error: 'Gecersiz fatura guncelleme verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTablesAvailable(admin);

    const currentResult = await admin
      .from('finance_invoices')
      .select(
        'id, bureau_id, case_id, client_id, responsible_user_id, proposal_id, contract_id, billing_model, invoice_date, due_date, status, currency, subtotal, discount_total, vat_rate, vat_total, withholding_rate, withholding_total, total_amount, amount_paid, amount_due, description, last_reminder_at, reminder_note, created_at, updated_at',
      )
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .maybeSingle();

    if (currentResult.error || !currentResult.data) {
      return Response.json({ error: 'Fatura bulunamadi.' }, { status: 404 });
    }

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, currentResult.data.case_id);

    const updateResult = await admin
      .from('finance_invoices')
      .update({
        due_date: payload.data.dueDate ?? currentResult.data.due_date,
        status: payload.data.status ?? currentResult.data.status,
        description: payload.data.description ?? currentResult.data.description,
        reminder_note: payload.data.reminderNote ?? currentResult.data.reminder_note,
        last_reminder_at: payload.data.recordReminder ? new Date().toISOString() : currentResult.data.last_reminder_at,
      })
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .select(
        'id, invoice_no, case_id, client_id, responsible_user_id, proposal_id, contract_id, billing_model, invoice_date, due_date, status, currency, subtotal, discount_total, vat_rate, vat_total, withholding_rate, withholding_total, total_amount, amount_paid, amount_due, description, last_reminder_at, reminder_note, created_at, updated_at',
      )
      .single();

    if (updateResult.error || !updateResult.data) {
      return Response.json({ error: 'Fatura guncellenemedi.' }, { status: 500 });
    }

    const invoice = recalculateStatus(mapInvoiceRow(updateResult.data as Record<string, unknown>));

    if (invoice.status !== updateResult.data.status) {
      await admin
        .from('finance_invoices')
        .update({ status: invoice.status })
        .eq('id', payload.data.id)
        .eq('bureau_id', access.bureauId)
        .is('deleted_at', null);
    }

    return Response.json({ item: invoice });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fatura guncellenemedi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
