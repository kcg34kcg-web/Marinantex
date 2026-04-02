import type {
  FinanceBootstrapResponse,
  FinanceContract,
  FinanceExpense,
  FinanceInvoice,
  FinanceListResponse,
  FinanceOverviewResponse,
  FinancePayment,
  FinancePaymentLink,
  FinanceProposal,
  FinanceRetainer,
  FinanceTaxConfig,
  FinanceTaxSummary,
  FinanceTimeEntry,
} from '@/types/finance-ops';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

type RequestOptions = {
  method?: Method;
  body?: Record<string, unknown>;
};

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(payload.error || 'API istegi basarisiz.');
  }

  return payload;
}

function queryString(params: Record<string, string | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') {
      search.set(key, value);
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function getFinanceBootstrap() {
  return apiRequest<FinanceBootstrapResponse>('/api/dashboard/finance/bootstrap');
}

export function getFinanceOverview() {
  return apiRequest<FinanceOverviewResponse>('/api/dashboard/finance/overview');
}

export async function listTimeEntries(filters: { caseId?: string; clientId?: string; dateFrom?: string; dateTo?: string }) {
  const response = await apiRequest<FinanceListResponse<FinanceTimeEntry>>(
    `/api/dashboard/finance/time-entries${queryString(filters)}`,
  );
  return response.items;
}

export async function createTimeEntry(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinanceTimeEntry }>('/api/dashboard/finance/time-entries', {
    method: 'POST',
    body,
  });
  return response.item;
}

export async function updateTimeEntry(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinanceTimeEntry }>('/api/dashboard/finance/time-entries', {
    method: 'PATCH',
    body,
  });
  return response.item;
}

export async function deleteTimeEntry(id: string) {
  await apiRequest<{ success: boolean }>('/api/dashboard/finance/time-entries', {
    method: 'DELETE',
    body: { id },
  });
}

export async function listExpenses(filters: {
  caseId?: string;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  category?: string;
}) {
  const response = await apiRequest<FinanceListResponse<FinanceExpense>>(`/api/dashboard/finance/expenses${queryString(filters)}`);
  return response.items;
}

export async function createExpense(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinanceExpense }>('/api/dashboard/finance/expenses', {
    method: 'POST',
    body,
  });
  return response.item;
}

export async function updateExpense(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinanceExpense }>('/api/dashboard/finance/expenses', {
    method: 'PATCH',
    body,
  });
  return response.item;
}

export async function deleteExpense(id: string) {
  await apiRequest<{ success: boolean }>('/api/dashboard/finance/expenses', {
    method: 'DELETE',
    body: { id },
  });
}

export async function listInvoices(filters: { caseId?: string; clientId?: string; status?: string }) {
  const response = await apiRequest<FinanceListResponse<FinanceInvoice>>(`/api/dashboard/finance/invoices${queryString(filters)}`);
  return response.items;
}

export async function createInvoice(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinanceInvoice }>('/api/dashboard/finance/invoices', {
    method: 'POST',
    body,
  });
  return response.item;
}

export async function updateInvoice(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinanceInvoice }>('/api/dashboard/finance/invoices', {
    method: 'PATCH',
    body,
  });
  return response.item;
}

export async function listPayments(filters: {
  caseId?: string;
  clientId?: string;
  invoiceId?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const response = await apiRequest<FinanceListResponse<FinancePayment>>(`/api/dashboard/finance/payments${queryString(filters)}`);
  return response.items;
}

export async function createPayment(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinancePayment }>('/api/dashboard/finance/payments', {
    method: 'POST',
    body,
  });
  return response.item;
}

export async function deletePayment(id: string) {
  await apiRequest<{ success: boolean }>('/api/dashboard/finance/payments', {
    method: 'DELETE',
    body: { id },
  });
}

export async function listPaymentLinks(filters: {
  caseId?: string;
  clientId?: string;
  invoiceId?: string;
  status?: string;
}) {
  const response = await apiRequest<FinanceListResponse<FinancePaymentLink>>(
    `/api/dashboard/finance/payment-links${queryString(filters)}`,
  );
  return response.items;
}

export async function createPaymentLink(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinancePaymentLink }>('/api/dashboard/finance/payment-links', {
    method: 'POST',
    body,
  });
  return response.item;
}

export async function updatePaymentLink(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinancePaymentLink }>('/api/dashboard/finance/payment-links', {
    method: 'PATCH',
    body,
  });
  return response.item;
}

export async function listProposals(filters: { caseId?: string; clientId?: string; status?: string }) {
  const response = await apiRequest<FinanceListResponse<FinanceProposal>>(
    `/api/dashboard/finance/proposals${queryString(filters)}`,
  );
  return response.items;
}

export async function createProposal(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinanceProposal }>('/api/dashboard/finance/proposals', {
    method: 'POST',
    body,
  });
  return response.item;
}

export async function listContracts(filters: {
  caseId?: string;
  clientId?: string;
  proposalId?: string;
  status?: string;
}) {
  const response = await apiRequest<FinanceListResponse<FinanceContract>>(
    `/api/dashboard/finance/contracts${queryString(filters)}`,
  );
  return response.items;
}

export async function createContract(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinanceContract }>('/api/dashboard/finance/contracts', {
    method: 'POST',
    body,
  });
  return response.item;
}

export async function listRetainers(filters: {
  caseId?: string;
  clientId?: string;
  status?: string;
  retainerType?: string;
}) {
  const response = await apiRequest<FinanceListResponse<FinanceRetainer>>(
    `/api/dashboard/finance/retainers${queryString(filters)}`,
  );
  return response.items;
}

export async function createRetainer(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinanceRetainer }>('/api/dashboard/finance/retainers', {
    method: 'POST',
    body,
  });
  return response.item;
}

export async function updateRetainer(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinanceRetainer }>('/api/dashboard/finance/retainers', {
    method: 'PATCH',
    body,
  });
  return response.item;
}

export async function getTaxConfig() {
  const response = await apiRequest<{ item: FinanceTaxConfig }>('/api/dashboard/finance/tax-config');
  return response.item;
}

export async function updateTaxConfig(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinanceTaxConfig }>('/api/dashboard/finance/tax-config', {
    method: 'PATCH',
    body,
  });
  return response.item;
}

export async function listTaxSummaries(filters: { periodType?: string; dateFrom?: string; dateTo?: string }) {
  const response = await apiRequest<FinanceListResponse<FinanceTaxSummary>>(
    `/api/dashboard/finance/tax-summaries${queryString(filters)}`,
  );
  return response.items;
}

export async function createTaxSummary(body: Record<string, unknown>) {
  const response = await apiRequest<{ item: FinanceTaxSummary }>('/api/dashboard/finance/tax-summaries', {
    method: 'POST',
    body,
  });
  return response.item;
}
