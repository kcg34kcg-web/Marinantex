import Decimal from 'decimal.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FinanceCaseOption,
  FinanceClientOption,
  FinanceContract,
  FinanceExpense,
  FinanceInvoice,
  FinancePayment,
  FinancePaymentLink,
  FinanceProposal,
  FinanceRetainer,
  FinanceTaxConfig,
  FinanceTaxSummary,
  FinanceTeamMemberOption,
  FinanceTimeEntry,
} from '@/types/finance-ops';
import { canAccessCase } from '@/lib/dashboard/access';
import type { InternalOfficeRole } from '@/lib/office/team-access';
import { resolveAccessibleClientIds, resolveInternalUserBureauScope } from '@/lib/dashboard/client-access';

export interface FinanceAccessContext {
  userId: string;
  role: InternalOfficeRole;
  bureauId: string;
}

export interface FinanceScopeData {
  cases: FinanceCaseOption[];
  clients: FinanceClientOption[];
  teamMembers: FinanceTeamMemberOption[];
}

const PROFILE_SELECT = 'id, full_name, role';
const CASE_SELECT = 'id, title, file_no, client_display_name, status, lawyer_id, bureau_id';

export function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (value instanceof Decimal) {
    return value.toNumber();
  }

  return 0;
}

export function toMoneyFixed(value: Decimal.Value, scale = 2): string {
  return new Decimal(value || 0).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale);
}

export function utcDateOnly(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

export function firstDayOfMonth(date = new Date()): string {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return first.toISOString().slice(0, 10);
}

export function lastDayOfMonth(date = new Date()): string {
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return last.toISOString().slice(0, 10);
}

export function createSequenceCode(prefix: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${prefix}-${year}${month}-${token}`;
}

async function fetchScopedCases(
  admin: SupabaseClient,
  access: FinanceAccessContext,
): Promise<Array<{ id: string; title: string; file_no: string | null; client_display_name: string | null; status: string; lawyer_id: string }>> {
  const withBureau = await admin.from('cases').select(CASE_SELECT).eq('bureau_id', access.bureauId).order('updated_at', { ascending: false }).limit(500);

  if (!withBureau.error) {
    const rows = (withBureau.data ?? []) as Array<{
      id: string;
      title: string;
      file_no: string | null;
      client_display_name: string | null;
      status: string;
      lawyer_id: string;
    }>;

    if (access.role === 'lawyer') {
      return rows.filter((row) => row.lawyer_id === access.userId);
    }

    return rows;
  }

  if (withBureau.error.code !== '42703') {
    throw new Error('Dosya kapsamı alınamadı.');
  }

  if (access.role === 'lawyer') {
    const direct = await admin
      .from('cases')
      .select('id, title, file_no, client_display_name, status, lawyer_id')
      .eq('lawyer_id', access.userId)
      .order('updated_at', { ascending: false })
      .limit(500);

    if (direct.error) {
      throw new Error('Dosya kapsamı alınamadı.');
    }

    return (direct.data ?? []) as Array<{
      id: string;
      title: string;
      file_no: string | null;
      client_display_name: string | null;
      status: string;
      lawyer_id: string;
    }>;
  }

  const scope = await resolveInternalUserBureauScope(admin, access.userId);
  if (!scope || scope.bureauProfileIds.length === 0) {
    return [];
  }

  const scoped = await admin
    .from('cases')
    .select('id, title, file_no, client_display_name, status, lawyer_id')
    .in('lawyer_id', scope.bureauProfileIds)
    .order('updated_at', { ascending: false })
    .limit(500);

  if (scoped.error) {
    throw new Error('Dosya kapsamı alınamadı.');
  }

  return (scoped.data ?? []) as Array<{
    id: string;
    title: string;
    file_no: string | null;
    client_display_name: string | null;
    status: string;
    lawyer_id: string;
  }>;
}

async function fetchScopedClients(
  admin: SupabaseClient,
  access: FinanceAccessContext,
): Promise<FinanceClientOption[]> {
  const clientsResult = await admin
    .from('clients')
    .select('id, full_name, file_no, public_ref_code, created_by, profile_id')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(700);

  if (clientsResult.error?.code === '42P01') {
    return [];
  }

  if (clientsResult.error) {
    throw new Error('Müvekkil listesi alınamadı.');
  }

  const clientRows = (clientsResult.data ?? []) as Array<{
    id: string;
    full_name: string;
    file_no: string | null;
    public_ref_code: string | null;
    created_by: string | null;
    profile_id: string | null;
  }>;

  const scope = await resolveInternalUserBureauScope(admin, access.userId);
  if (!scope) {
    return [];
  }

  const accessible = await resolveAccessibleClientIds(admin, {
    clientIds: clientRows.map((row) => row.id),
    bureauId: access.bureauId,
    bureauProfileIds: scope.bureauProfileIds,
  });

  return clientRows
    .filter((row) => accessible.has(row.id))
    .map((row) => ({
      id: row.id,
      fullName: row.full_name,
      fileNo: row.file_no,
      publicRefCode: row.public_ref_code,
    }));
}

async function fetchTeamMembers(admin: SupabaseClient, access: FinanceAccessContext): Promise<FinanceTeamMemberOption[]> {
  const scope = await resolveInternalUserBureauScope(admin, access.userId);
  if (!scope || scope.bureauProfileIds.length === 0) {
    return [];
  }

  const membersResult = await admin
    .from('profiles')
    .select(PROFILE_SELECT)
    .in('id', scope.bureauProfileIds)
    .order('full_name', { ascending: true })
    .limit(300);

  if (membersResult.error) {
    throw new Error('Ekip üyeleri alınamadı.');
  }

  return ((membersResult.data ?? []) as Array<{ id: string; full_name: string | null; role: 'lawyer' | 'assistant' | 'client' }>).map((row) => ({
    id: row.id,
    fullName: row.full_name ?? 'Isimsiz',
    role: row.role,
  }));
}

export async function loadFinanceScopeData(
  admin: SupabaseClient,
  access: FinanceAccessContext,
): Promise<FinanceScopeData> {
  const scopedCases = await fetchScopedCases(admin, access);
  const cases = scopedCases.map((row) => ({
    id: row.id,
    title: row.title,
    fileNo: row.file_no,
    clientDisplayName: row.client_display_name,
    status: row.status,
  }));

  const clients = await fetchScopedClients(
    admin,
    access,
  );

  const teamMembers = await fetchTeamMembers(admin, access);

  return {
    cases,
    clients,
    teamMembers,
  };
}

export async function assertCaseAccessible(
  admin: SupabaseClient,
  access: FinanceAccessContext,
  caseId: string | null | undefined,
): Promise<void> {
  if (!caseId) {
    return;
  }

  const allowed = await canAccessCase(admin, {
    caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    throw new Error('Bu dosyada işlem yetkiniz yok.');
  }
}

export function mapTimeEntryRow(row: Record<string, unknown>): FinanceTimeEntry {
  return {
    id: String(row.id),
    caseId: (row.case_id as string | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
    responsibleUserId: (row.responsible_user_id as string | null) ?? null,
    workType: row.work_type as FinanceTimeEntry['workType'],
    source: row.source as FinanceTimeEntry['source'],
    workDate: String(row.work_date),
    durationMinutes: toNumber(row.duration_minutes),
    roundedMinutes: toNumber(row.rounded_minutes),
    minBillingMinutes: toNumber(row.min_billing_minutes),
    roundingMinutes: toNumber(row.rounding_minutes),
    billable: Boolean(row.billable),
    internalHourlyCost: toNumber(row.internal_hourly_cost),
    salesHourlyRate: toNumber(row.sales_hourly_rate),
    internalCostAmount: toNumber(row.internal_cost_amount),
    billableAmount: toNumber(row.billable_amount),
    currency: String(row.currency ?? 'TRY'),
    note: (row.note as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    endedAt: (row.ended_at as string | null) ?? null,
    invoiceId: (row.invoice_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapExpenseRow(row: Record<string, unknown>): FinanceExpense {
  return {
    id: String(row.id),
    caseId: (row.case_id as string | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
    responsibleUserId: (row.responsible_user_id as string | null) ?? null,
    category: row.category as FinanceExpense['category'],
    expenseDate: String(row.expense_date),
    amount: toNumber(row.amount),
    currency: String(row.currency ?? 'TRY'),
    description: (row.description as string | null) ?? null,
    documentNo: (row.document_no as string | null) ?? null,
    documentDate: (row.document_date as string | null) ?? null,
    supplierName: (row.supplier_name as string | null) ?? null,
    vatRate: toNumber(row.vat_rate),
    vatIncluded: Boolean(row.vat_included),
    vatAmount: toNumber(row.vat_amount),
    netAmount: toNumber(row.net_amount),
    grossAmount: toNumber(row.gross_amount),
    billableToClient: Boolean(row.billable_to_client),
    coveredByRetainer: Boolean(row.covered_by_retainer),
    receiptPath: (row.receipt_path as string | null) ?? null,
    invoiceId: (row.invoice_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapInvoiceRow(row: Record<string, unknown>): FinanceInvoice {
  return {
    id: String(row.id),
    invoiceNo: String(row.invoice_no),
    caseId: (row.case_id as string | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
    responsibleUserId: (row.responsible_user_id as string | null) ?? null,
    proposalId: (row.proposal_id as string | null) ?? null,
    contractId: (row.contract_id as string | null) ?? null,
    billingModel: row.billing_model as FinanceInvoice['billingModel'],
    invoiceDate: String(row.invoice_date),
    dueDate: (row.due_date as string | null) ?? null,
    status: row.status as FinanceInvoice['status'],
    currency: String(row.currency ?? 'TRY'),
    subtotal: toNumber(row.subtotal),
    discountTotal: toNumber(row.discount_total),
    vatRate: toNumber(row.vat_rate),
    vatTotal: toNumber(row.vat_total),
    withholdingRate: toNumber(row.withholding_rate),
    withholdingTotal: toNumber(row.withholding_total),
    totalAmount: toNumber(row.total_amount),
    amountPaid: toNumber(row.amount_paid),
    amountDue: toNumber(row.amount_due),
    description: (row.description as string | null) ?? null,
    lastReminderAt: (row.last_reminder_at as string | null) ?? null,
    reminderNote: (row.reminder_note as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapPaymentRow(row: Record<string, unknown>): FinancePayment {
  return {
    id: String(row.id),
    paymentNo: String(row.payment_no),
    invoiceId: (row.invoice_id as string | null) ?? null,
    paymentLinkId: (row.payment_link_id as string | null) ?? null,
    retainerId: (row.retainer_id as string | null) ?? null,
    caseId: (row.case_id as string | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
    responsibleUserId: (row.responsible_user_id as string | null) ?? null,
    paymentDate: String(row.payment_date),
    amount: toNumber(row.amount),
    currency: String(row.currency ?? 'TRY'),
    paymentMethod: row.payment_method as FinancePayment['paymentMethod'],
    referenceNo: (row.reference_no as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function mapPaymentLinkRow(row: Record<string, unknown>): FinancePaymentLink {
  return {
    id: String(row.id),
    linkCode: String(row.link_code),
    invoiceId: (row.invoice_id as string | null) ?? null,
    retainerId: (row.retainer_id as string | null) ?? null,
    caseId: (row.case_id as string | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
    responsibleUserId: (row.responsible_user_id as string | null) ?? null,
    linkType: row.link_type as FinancePaymentLink['linkType'],
    status: row.status as FinancePaymentLink['status'],
    provider: String(row.provider),
    amount: toNumber(row.amount),
    currency: String(row.currency ?? 'TRY'),
    url: (row.url as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    paidAt: (row.paid_at as string | null) ?? null,
    failedAt: (row.failed_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function mapTaxConfigRow(row: Record<string, unknown>): FinanceTaxConfig {
  return {
    id: String(row.id),
    vatRate: toNumber(row.vat_rate),
    withholdingRate: toNumber(row.withholding_rate),
    estimatedIncomeTaxRate: toNumber(row.estimated_income_tax_rate),
    minBillingMinutes: toNumber(row.min_billing_minutes),
    billingRoundingMinutes: toNumber(row.billing_rounding_minutes),
    defaultCurrency: String(row.default_currency ?? 'TRY'),
  };
}

export function mapProposalRow(row: Record<string, unknown>): FinanceProposal {
  return {
    id: String(row.id),
    proposalNo: String(row.proposal_no),
    caseId: (row.case_id as string | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
    responsibleUserId: (row.responsible_user_id as string | null) ?? null,
    billingModel: row.billing_model as FinanceProposal['billingModel'],
    proposalDate: String(row.proposal_date),
    validUntil: (row.valid_until as string | null) ?? null,
    hourlyRate: row.hourly_rate == null ? null : toNumber(row.hourly_rate),
    fixedFeeAmount: row.fixed_fee_amount == null ? null : toNumber(row.fixed_fee_amount),
    successFeeRate: row.success_fee_rate == null ? null : toNumber(row.success_fee_rate),
    retainerAmount: row.retainer_amount == null ? null : toNumber(row.retainer_amount),
    vatRate: row.vat_rate == null ? null : toNumber(row.vat_rate),
    withholdingRate: row.withholding_rate == null ? null : toNumber(row.withholding_rate),
    currency: String(row.currency ?? 'TRY'),
    status: row.status as FinanceProposal['status'],
    notes: (row.notes as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapContractRow(row: Record<string, unknown>): FinanceContract {
  return {
    id: String(row.id),
    contractNo: String(row.contract_no),
    caseId: (row.case_id as string | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
    responsibleUserId: (row.responsible_user_id as string | null) ?? null,
    proposalId: (row.proposal_id as string | null) ?? null,
    billingModel: row.billing_model as FinanceContract['billingModel'],
    signedAt: (row.signed_at as string | null) ?? null,
    startsAt: (row.starts_at as string | null) ?? null,
    endsAt: (row.ends_at as string | null) ?? null,
    hourlyRate: row.hourly_rate == null ? null : toNumber(row.hourly_rate),
    fixedFeeAmount: row.fixed_fee_amount == null ? null : toNumber(row.fixed_fee_amount),
    successFeeRate: row.success_fee_rate == null ? null : toNumber(row.success_fee_rate),
    monthlyRetainerAmount: row.monthly_retainer_amount == null ? null : toNumber(row.monthly_retainer_amount),
    vatRate: row.vat_rate == null ? null : toNumber(row.vat_rate),
    withholdingRate: row.withholding_rate == null ? null : toNumber(row.withholding_rate),
    currency: String(row.currency ?? 'TRY'),
    status: row.status as FinanceContract['status'],
    terms: (row.terms as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapRetainerRow(row: Record<string, unknown>): FinanceRetainer {
  return {
    id: String(row.id),
    retainerNo: String(row.retainer_no),
    caseId: (row.case_id as string | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
    responsibleUserId: (row.responsible_user_id as string | null) ?? null,
    contractId: (row.contract_id as string | null) ?? null,
    retainerType: row.retainer_type as FinanceRetainer['retainerType'],
    status: row.status as FinanceRetainer['status'],
    receivedDate: String(row.received_date),
    amount: toNumber(row.amount),
    usedAmount: toNumber(row.used_amount),
    remainingAmount: toNumber(row.remaining_amount),
    refundableAmount: toNumber(row.refundable_amount),
    currency: String(row.currency ?? 'TRY'),
    note: (row.note as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapTaxSummaryRow(row: Record<string, unknown>): FinanceTaxSummary {
  return {
    id: String(row.id),
    periodType: row.period_type as FinanceTaxSummary['periodType'],
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    outputVat: toNumber(row.output_vat),
    deductibleVat: toNumber(row.deductible_vat),
    netVatPosition: toNumber(row.net_vat_position),
    withholdingTotal: toNumber(row.withholding_total),
    estimatedIncomeTax: toNumber(row.estimated_income_tax),
    grossProfit: toNumber(row.gross_profit),
    netProfitAfterTax: toNumber(row.net_profit_after_tax),
    currency: String(row.currency ?? 'TRY'),
    generatedAt: String(row.generated_at),
  };
}
