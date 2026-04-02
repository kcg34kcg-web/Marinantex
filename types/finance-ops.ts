export type FinanceBillingModel = 'hourly' | 'fixed_fee' | 'success_fee' | 'retainer' | 'mixed';

export type FinanceInvoiceStatus =
  | 'draft'
  | 'issued'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled';

export type FinanceTimeSource = 'manual' | 'timer';

export type FinanceWorkType =
  | 'hearing'
  | 'petition'
  | 'consulting'
  | 'research'
  | 'travel'
  | 'waiting'
  | 'other';

export type FinanceExpenseCategory =
  | 'harc'
  | 'tebligat'
  | 'bilirkisi'
  | 'kesif'
  | 'uyap_noter_baro'
  | 'travel_accommodation'
  | 'courier_post'
  | 'translation'
  | 'office_expense'
  | 'external_consultant'
  | 'other';

export type FinancePaymentMethod = 'wire' | 'eft' | 'cash' | 'credit_card' | 'online_link';

export type FinancePaymentLinkStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';

export type FinancePaymentLinkType = 'invoice' | 'partial_invoice' | 'retainer';

export type FinanceRetainerType = 'service' | 'expense';

export type FinanceRetainerStatus = 'active' | 'exhausted' | 'refunded' | 'closed';

export type FinanceProposalStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export type FinanceContractStatus = 'draft' | 'active' | 'expired' | 'terminated';

export type FinanceTaxPeriodType = 'monthly' | 'quarterly' | 'yearly';

export interface FinanceCaseOption {
  id: string;
  title: string;
  fileNo: string | null;
  clientDisplayName: string | null;
  status: string;
}

export interface FinanceClientOption {
  id: string;
  fullName: string;
  fileNo: string | null;
  publicRefCode: string | null;
}

export interface FinanceTeamMemberOption {
  id: string;
  fullName: string;
  role: 'lawyer' | 'assistant' | 'client';
}

export interface FinanceTaxConfig {
  id: string;
  vatRate: number;
  withholdingRate: number;
  estimatedIncomeTaxRate: number;
  minBillingMinutes: number;
  billingRoundingMinutes: number;
  defaultCurrency: string;
}

export interface FinanceBootstrapResponse {
  nowIso: string;
  cases: FinanceCaseOption[];
  clients: FinanceClientOption[];
  teamMembers: FinanceTeamMemberOption[];
  taxConfig: FinanceTaxConfig | null;
}

export interface FinanceTimeEntry {
  id: string;
  caseId: string | null;
  clientId: string | null;
  responsibleUserId: string | null;
  workType: FinanceWorkType;
  source: FinanceTimeSource;
  workDate: string;
  durationMinutes: number;
  roundedMinutes: number;
  minBillingMinutes: number;
  roundingMinutes: number;
  billable: boolean;
  internalHourlyCost: number;
  salesHourlyRate: number;
  internalCostAmount: number;
  billableAmount: number;
  currency: string;
  note: string | null;
  startedAt: string | null;
  endedAt: string | null;
  invoiceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceExpense {
  id: string;
  caseId: string | null;
  clientId: string | null;
  responsibleUserId: string | null;
  category: FinanceExpenseCategory;
  expenseDate: string;
  amount: number;
  currency: string;
  description: string | null;
  documentNo: string | null;
  documentDate: string | null;
  supplierName: string | null;
  vatRate: number;
  vatIncluded: boolean;
  vatAmount: number;
  netAmount: number;
  grossAmount: number;
  billableToClient: boolean;
  coveredByRetainer: boolean;
  receiptPath: string | null;
  invoiceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceInvoice {
  id: string;
  invoiceNo: string;
  caseId: string | null;
  clientId: string | null;
  responsibleUserId: string | null;
  proposalId: string | null;
  contractId: string | null;
  billingModel: FinanceBillingModel;
  invoiceDate: string;
  dueDate: string | null;
  status: FinanceInvoiceStatus;
  currency: string;
  subtotal: number;
  discountTotal: number;
  vatRate: number;
  vatTotal: number;
  withholdingRate: number;
  withholdingTotal: number;
  totalAmount: number;
  amountPaid: number;
  amountDue: number;
  description: string | null;
  lastReminderAt: string | null;
  reminderNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinancePayment {
  id: string;
  paymentNo: string;
  invoiceId: string | null;
  paymentLinkId: string | null;
  retainerId: string | null;
  caseId: string | null;
  clientId: string | null;
  responsibleUserId: string | null;
  paymentDate: string;
  amount: number;
  currency: string;
  paymentMethod: FinancePaymentMethod;
  referenceNo: string | null;
  note: string | null;
  createdAt: string;
}

export interface FinancePaymentLink {
  id: string;
  linkCode: string;
  invoiceId: string | null;
  retainerId: string | null;
  caseId: string | null;
  clientId: string | null;
  responsibleUserId: string | null;
  linkType: FinancePaymentLinkType;
  status: FinancePaymentLinkStatus;
  provider: string;
  amount: number;
  currency: string;
  url: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

export interface FinanceOverviewCardSet {
  collectedThisMonth: number;
  invoicedThisMonth: number;
  pendingCollection: number;
  overdueCollection: number;
  unbilledTimeAmount: number;
  uninvoicedExpenseAmount: number;
  estimatedTaxReserve: number;
  netCashFlow: number;
}

export interface FinanceOverviewTaxBreakdown {
  outputVat: number;
  deductibleVat: number;
  netVatPosition: number;
  withholdingTotal: number;
  estimatedIncomeTax: number;
  grossProfit: number;
  netProfitAfterTax: number;
}

export interface FinanceProfitabilityRow {
  caseId: string;
  caseTitle: string;
  revenue: number;
  directExpense: number;
  laborCost: number;
  netProfit: number;
  uncollectedRevenue: number;
}

export interface FinanceRiskReceivableRow {
  invoiceId: string;
  invoiceNo: string;
  caseId: string | null;
  caseTitle: string | null;
  clientId: string | null;
  clientName: string | null;
  amountDue: number;
  dueDate: string | null;
  delayDays: number;
}

export interface FinanceOverviewResponse {
  cards: FinanceOverviewCardSet;
  tax: FinanceOverviewTaxBreakdown;
  profitabilityByCase: FinanceProfitabilityRow[];
  riskyReceivables: FinanceRiskReceivableRow[];
}

export interface FinanceListResponse<T> {
  items: T[];
}

export interface FinanceProposal {
  id: string;
  proposalNo: string;
  caseId: string | null;
  clientId: string | null;
  responsibleUserId: string | null;
  billingModel: FinanceBillingModel;
  proposalDate: string;
  validUntil: string | null;
  hourlyRate: number | null;
  fixedFeeAmount: number | null;
  successFeeRate: number | null;
  retainerAmount: number | null;
  vatRate: number | null;
  withholdingRate: number | null;
  currency: string;
  status: FinanceProposalStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceContract {
  id: string;
  contractNo: string;
  caseId: string | null;
  clientId: string | null;
  responsibleUserId: string | null;
  proposalId: string | null;
  billingModel: FinanceBillingModel;
  signedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  hourlyRate: number | null;
  fixedFeeAmount: number | null;
  successFeeRate: number | null;
  monthlyRetainerAmount: number | null;
  vatRate: number | null;
  withholdingRate: number | null;
  currency: string;
  status: FinanceContractStatus;
  terms: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceRetainer {
  id: string;
  retainerNo: string;
  caseId: string | null;
  clientId: string | null;
  responsibleUserId: string | null;
  contractId: string | null;
  retainerType: FinanceRetainerType;
  status: FinanceRetainerStatus;
  receivedDate: string;
  amount: number;
  usedAmount: number;
  remainingAmount: number;
  refundableAmount: number;
  currency: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceTaxSummary {
  id: string;
  periodType: FinanceTaxPeriodType;
  periodStart: string;
  periodEnd: string;
  outputVat: number;
  deductibleVat: number;
  netVatPosition: number;
  withholdingTotal: number;
  estimatedIncomeTax: number;
  grossProfit: number;
  netProfitAfterTax: number;
  currency: string;
  generatedAt: string;
}
