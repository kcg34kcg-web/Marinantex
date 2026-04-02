import Decimal from 'decimal.js';
import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import {
  assertCaseAccessible,
  createSequenceCode,
  mapPaymentRow,
  toNumber,
  utcDateOnly,
  type FinanceAccessContext,
} from '@/lib/dashboard/finance';
import type { FinanceListResponse, FinancePayment } from '@/types/finance-ops';

const querySchema = z.object({
  invoiceId: z.string().uuid().optional(),
  caseId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

const createSchema = z.object({
  invoiceId: z.string().uuid().nullable().optional(),
  paymentLinkId: z.string().uuid().nullable().optional(),
  retainerId: z.string().uuid().nullable().optional(),
  caseId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  responsibleUserId: z.string().uuid().nullable().optional(),
  paymentDate: z.string().date().optional(),
  amount: z.coerce.number().positive().max(100000000),
  currency: z.string().trim().min(3).max(8).default('TRY'),
  paymentMethod: z.enum(['wire', 'eft', 'cash', 'credit_card', 'online_link']),
  referenceNo: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  installmentNo: z.coerce.number().int().positive().max(120).nullable().optional(),
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

function deriveInvoiceStatus(input: { amountDue: number; amountPaid: number; dueDate: string | null }):
  | 'draft'
  | 'issued'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled' {
  if (input.amountDue <= 0) {
    return 'paid';
  }

  if (input.amountPaid > 0 && input.amountDue > 0) {
    return 'partially_paid';
  }

  if (input.dueDate) {
    const dueAt = new Date(`${input.dueDate}T23:59:59Z`);
    if (!Number.isNaN(dueAt.getTime()) && dueAt.getTime() < Date.now()) {
      return 'overdue';
    }
  }

  return 'issued';
}

async function ensureTablesAvailable(admin: ReturnType<typeof createAdminClient>) {
  const [paymentProbe, invoiceProbe] = await Promise.all([
    admin.from('finance_payments').select('id').limit(1),
    admin.from('finance_invoices').select('id').limit(1),
  ]);

  if (paymentProbe.error?.code === '42P01' || invoiceProbe.error?.code === '42P01') {
    throw new Error('Finance tablolari hazir degil. rag_v2_step33_finance_ops_core.sql migrationini calistirin.');
  }
}

async function recomputeInvoiceTotals(
  admin: ReturnType<typeof createAdminClient>,
  input: { bureauId: string; invoiceId: string },
): Promise<void> {
  const [invoiceResult, paymentsResult] = await Promise.all([
    admin
      .from('finance_invoices')
      .select('id, total_amount, amount_paid, amount_due, due_date, status')
      .eq('id', input.invoiceId)
      .eq('bureau_id', input.bureauId)
      .is('deleted_at', null)
      .maybeSingle(),
    admin
      .from('finance_payments')
      .select('amount')
      .eq('invoice_id', input.invoiceId)
      .eq('bureau_id', input.bureauId)
      .is('deleted_at', null),
  ]);

  if (invoiceResult.error || !invoiceResult.data || paymentsResult.error) {
    return;
  }

  const paidTotal = ((paymentsResult.data ?? []) as Array<{ amount: number }>).reduce(
    (sum, row) => sum.add(new Decimal(toNumber(row.amount))),
    new Decimal(0),
  );
  const totalAmount = new Decimal(toNumber(invoiceResult.data.total_amount));
  const amountDue = Decimal.max(totalAmount.sub(paidTotal), 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const amountPaid = paidTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const status = deriveInvoiceStatus({
    amountDue: amountDue.toNumber(),
    amountPaid: amountPaid.toNumber(),
    dueDate: invoiceResult.data.due_date,
  });

  await admin
    .from('finance_invoices')
    .update({
      amount_paid: amountPaid.toNumber(),
      amount_due: amountDue.toNumber(),
      status,
    })
    .eq('id', input.invoiceId)
    .eq('bureau_id', input.bureauId)
    .is('deleted_at', null);
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
      invoiceId: params.get('invoiceId') ?? undefined,
      caseId: params.get('caseId') ?? undefined,
      clientId: params.get('clientId') ?? undefined,
      dateFrom: params.get('dateFrom') ?? undefined,
      dateTo: params.get('dateTo') ?? undefined,
    });

    if (!parsed.success) {
      return Response.json({ error: 'Gecersiz filtre parametreleri.' }, { status: 400 });
    }

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, parsed.data.caseId);

    let query = admin
      .from('finance_payments')
      .select(
        'id, payment_no, invoice_id, payment_link_id, retainer_id, case_id, client_id, responsible_user_id, payment_date, amount, currency, payment_method, reference_no, note, created_at',
      )
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .order('payment_date', { ascending: false })
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
    if (parsed.data.dateFrom) {
      query = query.gte('payment_date', parsed.data.dateFrom);
    }
    if (parsed.data.dateTo) {
      query = query.lte('payment_date', parsed.data.dateTo);
    }

    const result = await query;
    if (result.error) {
      return Response.json({ error: 'Tahsilat listesi alinamadi.' }, { status: 500 });
    }

    const items = ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => mapPaymentRow(row));
    const payload: FinanceListResponse<FinancePayment> = { items };
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tahsilat servis hatasi.';
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
      return Response.json({ error: 'Gecersiz tahsilat verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTablesAvailable(admin);

    let resolvedCaseId = payload.data.caseId ?? null;
    let resolvedClientId = payload.data.clientId ?? null;

    if (payload.data.invoiceId) {
      const invoiceResult = await admin
        .from('finance_invoices')
        .select('id, case_id, client_id, due_date')
        .eq('id', payload.data.invoiceId)
        .eq('bureau_id', access.bureauId)
        .is('deleted_at', null)
        .maybeSingle();

      if (invoiceResult.error || !invoiceResult.data) {
        return Response.json({ error: 'Bagli fatura bulunamadi.' }, { status: 404 });
      }

      resolvedCaseId = invoiceResult.data.case_id ?? resolvedCaseId;
      resolvedClientId = invoiceResult.data.client_id ?? resolvedClientId;
    }

    const scope = buildAccessContext({ userId: access.userId, role: access.role, bureauId: access.bureauId });
    await assertCaseAccessible(admin, scope, resolvedCaseId ?? null);

    const paymentNo = createSequenceCode('PAY');
    const paymentDate = payload.data.paymentDate ?? utcDateOnly(new Date());

    const insertResult = await admin
      .from('finance_payments')
      .insert({
        bureau_id: access.bureauId,
        payment_no: paymentNo,
        invoice_id: payload.data.invoiceId ?? null,
        payment_link_id: payload.data.paymentLinkId ?? null,
        retainer_id: payload.data.retainerId ?? null,
        case_id: resolvedCaseId,
        client_id: resolvedClientId,
        responsible_user_id: payload.data.responsibleUserId ?? access.userId,
        payment_date: paymentDate,
        amount: payload.data.amount,
        currency: payload.data.currency,
        payment_method: payload.data.paymentMethod,
        reference_no: payload.data.referenceNo ?? null,
        note: payload.data.note ?? null,
        installment_no: payload.data.installmentNo ?? null,
        created_by: access.userId,
      })
      .select(
        'id, payment_no, invoice_id, payment_link_id, retainer_id, case_id, client_id, responsible_user_id, payment_date, amount, currency, payment_method, reference_no, note, created_at',
      )
      .single();

    if (insertResult.error || !insertResult.data) {
      if (insertResult.error?.code === '23505') {
        return Response.json({ error: 'Tahsilat numarasi cakisti. Tekrar deneyin.' }, { status: 409 });
      }
      return Response.json({ error: 'Tahsilat kaydedilemedi.' }, { status: 500 });
    }

    if (payload.data.invoiceId) {
      await recomputeInvoiceTotals(admin, {
        bureauId: access.bureauId,
        invoiceId: payload.data.invoiceId,
      });
    }

    if (payload.data.paymentLinkId) {
      await admin
        .from('finance_payment_links')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          last_webhook_at: new Date().toISOString(),
        })
        .eq('id', payload.data.paymentLinkId)
        .eq('bureau_id', access.bureauId)
        .is('deleted_at', null);
    }

    return Response.json({ item: mapPaymentRow(insertResult.data as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tahsilat servis hatasi.';
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

    const currentResult = await admin
      .from('finance_payments')
      .select('id, invoice_id')
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .maybeSingle();

    if (currentResult.error || !currentResult.data) {
      return Response.json({ error: 'Tahsilat kaydi bulunamadi.' }, { status: 404 });
    }

    const deleteResult = await admin
      .from('finance_payments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', payload.data.id)
      .eq('bureau_id', access.bureauId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    if (deleteResult.error || !deleteResult.data) {
      return Response.json({ error: 'Tahsilat kaydi silinemedi.' }, { status: 500 });
    }

    if (currentResult.data.invoice_id) {
      await recomputeInvoiceTotals(admin, {
        bureauId: access.bureauId,
        invoiceId: currentResult.data.invoice_id,
      });
    }

    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tahsilat kaydi silinemedi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
