import Decimal from 'decimal.js';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import {
  firstDayOfMonth,
  lastDayOfMonth,
  loadFinanceScopeData,
  toNumber,
} from '@/lib/dashboard/finance';
import type { FinanceOverviewResponse } from '@/types/finance-ops';

function toDateValue(dateLike: string | null | undefined): number {
  if (!dateLike) {
    return Number.NaN;
  }
  return new Date(dateLike).getTime();
}

function isDateInRange(value: string | null | undefined, startDate: string, endDate: string): boolean {
  if (!value) {
    return false;
  }

  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) {
    return false;
  }

  return ts >= new Date(`${startDate}T00:00:00Z`).getTime() && ts <= new Date(`${endDate}T23:59:59Z`).getTime();
}

export async function GET() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  try {
    const admin = createAdminClient();

    const [scope, invoicesResult, paymentsResult, timeEntriesResult, expensesResult, invoiceItemsResult, taxConfigResult] = await Promise.all([
      loadFinanceScopeData(admin, {
        userId: access.userId,
        role: access.role,
        bureauId: access.bureauId,
      }),
      admin
        .from('finance_invoices')
        .select(
          'id, case_id, client_id, responsible_user_id, invoice_no, invoice_date, due_date, total_amount, amount_paid, amount_due, vat_total, withholding_total, status',
        )
        .eq('bureau_id', access.bureauId)
        .is('deleted_at', null)
        .limit(2000),
      admin
        .from('finance_payments')
        .select('id, case_id, client_id, responsible_user_id, invoice_id, payment_date, amount')
        .eq('bureau_id', access.bureauId)
        .is('deleted_at', null)
        .limit(3000),
      admin
        .from('finance_time_entries')
        .select('id, case_id, client_id, responsible_user_id, billable, billable_amount, internal_cost_amount')
        .eq('bureau_id', access.bureauId)
        .is('deleted_at', null)
        .limit(3000),
      admin
        .from('finance_expenses')
        .select('id, case_id, client_id, responsible_user_id, expense_date, billable_to_client, gross_amount, vat_amount')
        .eq('bureau_id', access.bureauId)
        .is('deleted_at', null)
        .limit(3000),
      admin
        .from('finance_invoice_items')
        .select('time_entry_id, expense_id')
        .eq('bureau_id', access.bureauId)
        .is('deleted_at', null)
        .limit(4000),
      admin
        .from('finance_tax_configs')
        .select('estimated_income_tax_rate')
        .eq('bureau_id', access.bureauId)
        .maybeSingle(),
    ]);

    if (
      invoicesResult.error?.code === '42P01' ||
      paymentsResult.error?.code === '42P01' ||
      timeEntriesResult.error?.code === '42P01' ||
      expensesResult.error?.code === '42P01' ||
      invoiceItemsResult.error?.code === '42P01'
    ) {
      return Response.json(
        { error: 'Finance tablolari hazir degil. rag_v2_step33_finance_ops_core.sql migrationini calistirin.' },
        { status: 503 },
      );
    }

    if (invoicesResult.error || paymentsResult.error || timeEntriesResult.error || expensesResult.error || invoiceItemsResult.error) {
      return Response.json({ error: 'Finans ozet verileri alinamadi.' }, { status: 500 });
    }

    const allowedCaseIds = new Set(scope.cases.map((row) => row.id));
    const allowedClientIds = new Set(scope.clients.map((row) => row.id));
    const caseNameById = new Map(scope.cases.map((row) => [row.id, row.title]));
    const clientNameById = new Map(scope.clients.map((row) => [row.id, row.fullName]));

    const invoices = ((invoicesResult.data ?? []) as Array<{
      id: string;
      case_id: string | null;
      client_id: string | null;
      responsible_user_id: string | null;
      invoice_no: string;
      invoice_date: string;
      due_date: string | null;
      total_amount: number;
      amount_paid: number;
      amount_due: number;
      vat_total: number;
      withholding_total: number;
      status: string;
    }>).filter((row) => {
      if (row.case_id && !allowedCaseIds.has(row.case_id)) {
        return false;
      }
      if (row.client_id && !allowedClientIds.has(row.client_id)) {
        return false;
      }
      if (access.role === 'lawyer' && !row.case_id && row.responsible_user_id !== access.userId) {
        return false;
      }
      return true;
    });

    const payments = ((paymentsResult.data ?? []) as Array<{
      id: string;
      case_id: string | null;
      client_id: string | null;
      responsible_user_id: string | null;
      invoice_id: string | null;
      payment_date: string;
      amount: number;
    }>).filter((row) => {
      if (row.case_id && !allowedCaseIds.has(row.case_id)) {
        return false;
      }
      if (row.client_id && !allowedClientIds.has(row.client_id)) {
        return false;
      }
      if (access.role === 'lawyer' && !row.case_id && row.responsible_user_id !== access.userId) {
        return false;
      }
      return true;
    });

    const timeEntries = ((timeEntriesResult.data ?? []) as Array<{
      id: string;
      case_id: string | null;
      client_id: string | null;
      responsible_user_id: string | null;
      billable: boolean;
      billable_amount: number;
      internal_cost_amount: number;
    }>).filter((row) => {
      if (row.case_id && !allowedCaseIds.has(row.case_id)) {
        return false;
      }
      if (row.client_id && !allowedClientIds.has(row.client_id)) {
        return false;
      }
      if (access.role === 'lawyer' && !row.case_id && row.responsible_user_id !== access.userId) {
        return false;
      }
      return true;
    });

    const expenses = ((expensesResult.data ?? []) as Array<{
      id: string;
      case_id: string | null;
      client_id: string | null;
      responsible_user_id: string | null;
      expense_date: string;
      billable_to_client: boolean;
      gross_amount: number;
      vat_amount: number;
    }>).filter((row) => {
      if (row.case_id && !allowedCaseIds.has(row.case_id)) {
        return false;
      }
      if (row.client_id && !allowedClientIds.has(row.client_id)) {
        return false;
      }
      if (access.role === 'lawyer' && !row.case_id && row.responsible_user_id !== access.userId) {
        return false;
      }
      return true;
    });

    const invoicedTimeIds = new Set(
      ((invoiceItemsResult.data ?? []) as Array<{ time_entry_id: string | null; expense_id: string | null }>)
        .map((row) => row.time_entry_id)
        .filter((value): value is string => Boolean(value)),
    );

    const invoicedExpenseIds = new Set(
      ((invoiceItemsResult.data ?? []) as Array<{ time_entry_id: string | null; expense_id: string | null }>)
        .map((row) => row.expense_id)
        .filter((value): value is string => Boolean(value)),
    );

    const monthStart = firstDayOfMonth(new Date());
    const monthEnd = lastDayOfMonth(new Date());

    const collectedThisMonth = payments
      .filter((row) => isDateInRange(row.payment_date, monthStart, monthEnd))
      .reduce((sum, row) => sum.add(toNumber(row.amount)), new Decimal(0));

    const invoicedThisMonth = invoices
      .filter((row) => isDateInRange(row.invoice_date, monthStart, monthEnd))
      .reduce((sum, row) => sum.add(toNumber(row.total_amount)), new Decimal(0));

    const pendingCollection = invoices.reduce((sum, row) => {
      if (row.status === 'cancelled') {
        return sum;
      }
      return sum.add(Decimal.max(toNumber(row.amount_due), 0));
    }, new Decimal(0));

    const overdueCollection = invoices.reduce((sum, row) => {
      const dueTs = toDateValue(row.due_date);
      if (row.status === 'cancelled' || Number.isNaN(dueTs) || dueTs >= Date.now()) {
        return sum;
      }
      return sum.add(Decimal.max(toNumber(row.amount_due), 0));
    }, new Decimal(0));

    const unbilledTimeAmount = timeEntries.reduce((sum, row) => {
      if (!row.billable || invoicedTimeIds.has(row.id)) {
        return sum;
      }
      return sum.add(toNumber(row.billable_amount));
    }, new Decimal(0));

    const uninvoicedExpenseAmount = expenses.reduce((sum, row) => {
      if (!row.billable_to_client || invoicedExpenseIds.has(row.id)) {
        return sum;
      }
      return sum.add(toNumber(row.gross_amount));
    }, new Decimal(0));

    const monthlyExpenseOutflow = expenses
      .filter((row) => isDateInRange(row.expense_date, monthStart, monthEnd))
      .reduce((sum, row) => sum.add(toNumber(row.gross_amount)), new Decimal(0));

    const outputVat = invoices.reduce((sum, row) => sum.add(toNumber(row.vat_total)), new Decimal(0));
    const deductibleVat = expenses.reduce((sum, row) => sum.add(toNumber(row.vat_amount)), new Decimal(0));
    const netVatPosition = outputVat.sub(deductibleVat).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const withholdingTotal = invoices.reduce((sum, row) => sum.add(toNumber(row.withholding_total)), new Decimal(0));

    const accrualRevenue = invoices.reduce((sum, row) => sum.add(toNumber(row.total_amount)), new Decimal(0));
    const directExpense = expenses.reduce((sum, row) => sum.add(toNumber(row.gross_amount)), new Decimal(0));
    const laborCost = timeEntries.reduce((sum, row) => sum.add(toNumber(row.internal_cost_amount)), new Decimal(0));
    const grossProfit = accrualRevenue.sub(directExpense).sub(laborCost);

    const estimatedIncomeTaxRate = toNumber(taxConfigResult.data?.estimated_income_tax_rate ?? 25);
    const estimatedIncomeTax = Decimal.max(grossProfit, 0)
      .mul(estimatedIncomeTaxRate)
      .div(100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const estimatedTaxReserve = Decimal.max(netVatPosition, 0).add(estimatedIncomeTax).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const netProfitAfterTax = grossProfit
      .sub(estimatedIncomeTax)
      .sub(Decimal.max(netVatPosition, 0))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const netCashFlow = collectedThisMonth.sub(monthlyExpenseOutflow).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const caseMetrics = new Map<
      string,
      {
        revenue: Decimal;
        directExpense: Decimal;
        laborCost: Decimal;
        uncollectedRevenue: Decimal;
      }
    >();

    const ensureCaseMetric = (caseId: string) => {
      const current =
        caseMetrics.get(caseId) ?? {
          revenue: new Decimal(0),
          directExpense: new Decimal(0),
          laborCost: new Decimal(0),
          uncollectedRevenue: new Decimal(0),
        };
      caseMetrics.set(caseId, current);
      return current;
    };

    invoices.forEach((row) => {
      if (!row.case_id) {
        return;
      }
      const metric = ensureCaseMetric(row.case_id);
      metric.revenue = metric.revenue.add(toNumber(row.total_amount));
      metric.uncollectedRevenue = metric.uncollectedRevenue.add(toNumber(row.amount_due));
    });

    expenses.forEach((row) => {
      if (!row.case_id) {
        return;
      }
      const metric = ensureCaseMetric(row.case_id);
      metric.directExpense = metric.directExpense.add(toNumber(row.gross_amount));
    });

    timeEntries.forEach((row) => {
      if (!row.case_id) {
        return;
      }
      const metric = ensureCaseMetric(row.case_id);
      metric.laborCost = metric.laborCost.add(toNumber(row.internal_cost_amount));
    });

    const profitabilityByCase = [...caseMetrics.entries()]
      .map(([caseId, metric]) => ({
        caseId,
        caseTitle: caseNameById.get(caseId) ?? 'Bilinmeyen Dosya',
        revenue: metric.revenue.toNumber(),
        directExpense: metric.directExpense.toNumber(),
        laborCost: metric.laborCost.toNumber(),
        netProfit: metric.revenue.sub(metric.directExpense).sub(metric.laborCost).toNumber(),
        uncollectedRevenue: metric.uncollectedRevenue.toNumber(),
      }))
      .sort((left, right) => right.netProfit - left.netProfit);

    const riskyReceivables = invoices
      .filter((row) => {
        if (toNumber(row.amount_due) <= 0) {
          return false;
        }

        const dueTs = toDateValue(row.due_date);
        return !Number.isNaN(dueTs) && dueTs < Date.now();
      })
      .map((row) => {
        const delayDays = Math.max(
          0,
          Math.floor((Date.now() - new Date(`${row.due_date ?? row.invoice_date}T23:59:59Z`).getTime()) / (1000 * 60 * 60 * 24)),
        );

        return {
          invoiceId: row.id,
          invoiceNo: row.invoice_no,
          caseId: row.case_id,
          caseTitle: row.case_id ? caseNameById.get(row.case_id) ?? null : null,
          clientId: row.client_id,
          clientName: row.client_id ? clientNameById.get(row.client_id) ?? null : null,
          amountDue: toNumber(row.amount_due),
          dueDate: row.due_date,
          delayDays,
        };
      })
      .sort((left, right) => right.delayDays - left.delayDays || right.amountDue - left.amountDue)
      .slice(0, 12);

    const response: FinanceOverviewResponse = {
      cards: {
        collectedThisMonth: collectedThisMonth.toNumber(),
        invoicedThisMonth: invoicedThisMonth.toNumber(),
        pendingCollection: pendingCollection.toNumber(),
        overdueCollection: overdueCollection.toNumber(),
        unbilledTimeAmount: unbilledTimeAmount.toNumber(),
        uninvoicedExpenseAmount: uninvoicedExpenseAmount.toNumber(),
        estimatedTaxReserve: estimatedTaxReserve.toNumber(),
        netCashFlow: netCashFlow.toNumber(),
      },
      tax: {
        outputVat: outputVat.toNumber(),
        deductibleVat: deductibleVat.toNumber(),
        netVatPosition: netVatPosition.toNumber(),
        withholdingTotal: withholdingTotal.toNumber(),
        estimatedIncomeTax: estimatedIncomeTax.toNumber(),
        grossProfit: grossProfit.toNumber(),
        netProfitAfterTax: netProfitAfterTax.toNumber(),
      },
      profitabilityByCase,
      riskyReceivables,
    };

    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Finans ozeti olusturulamadi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
