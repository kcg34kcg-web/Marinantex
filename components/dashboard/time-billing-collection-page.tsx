'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlarmClockPlus,
  BellRing,
  CircleDollarSign,
  Clock3,
  Copy,
  HandCoins,
  Link2,
  Pause,
  PieChart,
  Play,
  ReceiptText,
  RefreshCw,
  Save,
  Scale,
  Trash2,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  createContract,
  createExpense,
  createInvoice,
  createPayment,
  createPaymentLink,
  createProposal,
  createRetainer,
  createTaxSummary,
  createTimeEntry,
  deleteExpense,
  deletePayment,
  deleteTimeEntry,
  getFinanceBootstrap,
  getFinanceOverview,
  getTaxConfig,
  listContracts,
  listExpenses,
  listInvoices,
  listPaymentLinks,
  listPayments,
  listProposals,
  listRetainers,
  listTaxSummaries,
  listTimeEntries,
  updateExpense,
  updateInvoice,
  updatePaymentLink,
  updateRetainer,
  updateTaxConfig,
  updateTimeEntry,
} from '@/lib/dashboard/finance-client';
import { cn } from '@/lib/utils';
import type {
  FinanceBootstrapResponse,
  FinanceContract,
  FinanceExpense,
  FinanceExpenseCategory,
  FinanceInvoice,
  FinanceInvoiceStatus,
  FinanceOverviewResponse,
  FinancePayment,
  FinancePaymentLink,
  FinancePaymentLinkStatus,
  FinancePaymentMethod,
  FinanceProposal,
  FinanceRetainer,
  FinanceRetainerType,
  FinanceTaxConfig,
  FinanceTaxSummary,
  FinanceTimeEntry,
  FinanceWorkType,
} from '@/types/finance-ops';

const SELECT_CLASSNAME =
  'w-full min-h-[44px] rounded-xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] px-3 text-sm text-[var(--main-text,var(--text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring,var(--primary))] focus-visible:ring-offset-2';

const CURRENCY = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  maximumFractionDigits: 2,
});

const WORK_TYPE_LABELS: Record<FinanceWorkType, string> = {
  hearing: 'Durusma',
  petition: 'Dilekce',
  consulting: 'Danismanlik',
  research: 'Arastirma',
  travel: 'Yol',
  waiting: 'Bekleme',
  other: 'Diger',
};

const EXPENSE_CATEGORY_LABELS: Record<FinanceExpenseCategory, string> = {
  harc: 'Harc',
  tebligat: 'Tebligat',
  bilirkisi: 'Bilirkisi',
  kesif: 'Kesif',
  uyap_noter_baro: 'UYAP/Noter/Baro',
  travel_accommodation: 'Yol/Konaklama',
  courier_post: 'Kurye/Posta',
  translation: 'Tercume',
  office_expense: 'Ofis Gideri',
  external_consultant: 'Dis Danisman',
  other: 'Diger',
};

const INVOICE_STATUS_LABELS: Record<FinanceInvoiceStatus, string> = {
  draft: 'Taslak',
  issued: 'Kesildi',
  partially_paid: 'Kismi Odendi',
  paid: 'Odendi',
  overdue: 'Gecikti',
  cancelled: 'Iptal',
};

const PAYMENT_METHOD_LABELS: Record<FinancePaymentMethod, string> = {
  wire: 'Havale',
  eft: 'EFT',
  cash: 'Nakit',
  credit_card: 'Kredi Karti',
  online_link: 'Online Link',
};

const PAYMENT_LINK_STATUS_LABELS: Record<FinancePaymentLinkStatus, string> = {
  pending: 'Bekliyor',
  paid: 'Odendi',
  failed: 'Basarisiz',
  expired: 'Suresi Doldu',
  cancelled: 'Iptal',
};

type Notice = {
  type: 'success' | 'error';
  message: string;
};

type FiltersState = {
  caseId: string;
  clientId: string;
  dateFrom: string;
  dateTo: string;
};

type TimeFormState = {
  id: string;
  caseId: string;
  clientId: string;
  responsibleUserId: string;
  workType: FinanceWorkType;
  workDate: string;
  durationMinutes: string;
  minBillingMinutes: string;
  roundingMinutes: string;
  billable: boolean;
  internalHourlyCost: string;
  salesHourlyRate: string;
  note: string;
};

type ExpenseFormState = {
  id: string;
  caseId: string;
  clientId: string;
  responsibleUserId: string;
  category: FinanceExpenseCategory;
  expenseDate: string;
  amount: string;
  vatRate: string;
  vatIncluded: boolean;
  billableToClient: boolean;
  coveredByRetainer: boolean;
  description: string;
  documentNo: string;
  documentDate: string;
  supplierName: string;
  receiptPath: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function parseAmount(value: string): number {
  const parsed = Number(value.replace(',', '.').trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatMoney(value: number) {
  return CURRENCY.format(Number.isFinite(value) ? value : 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString('tr-TR');
}

function formatDuration(minutes: number) {
  const fullMinutes = Math.max(0, minutes);
  const hour = Math.floor(fullMinutes / 60);
  const minute = Math.round(fullMinutes % 60);
  if (hour === 0) {
    return `${minute} dk`;
  }
  return `${hour} sa ${minute} dk`;
}

function formatStopwatch(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function badgeForInvoiceStatus(status: FinanceInvoiceStatus): 'success' | 'warning' | 'critical' | 'muted' | 'blue' {
  if (status === 'paid') {
    return 'success';
  }
  if (status === 'overdue') {
    return 'critical';
  }
  if (status === 'partially_paid') {
    return 'warning';
  }
  if (status === 'issued') {
    return 'blue';
  }
  return 'muted';
}

function badgeForPaymentLinkStatus(status: FinancePaymentLinkStatus): 'success' | 'warning' | 'critical' | 'muted' {
  if (status === 'paid') {
    return 'success';
  }
  if (status === 'failed' || status === 'cancelled') {
    return 'critical';
  }
  if (status === 'expired') {
    return 'warning';
  }
  return 'muted';
}

function defaultTimeForm(config: FinanceTaxConfig | null, userId: string, caseId: string, clientId: string): TimeFormState {
  return {
    id: '',
    caseId,
    clientId,
    responsibleUserId: userId,
    workType: 'consulting',
    workDate: today(),
    durationMinutes: '30',
    minBillingMinutes: String(config?.minBillingMinutes ?? 6),
    roundingMinutes: String(config?.billingRoundingMinutes ?? 6),
    billable: true,
    internalHourlyCost: '900',
    salesHourlyRate: '2500',
    note: '',
  };
}

function defaultExpenseForm(userId: string, caseId: string, clientId: string): ExpenseFormState {
  return {
    id: '',
    caseId,
    clientId,
    responsibleUserId: userId,
    category: 'harc',
    expenseDate: today(),
    amount: '',
    vatRate: '20',
    vatIncluded: true,
    billableToClient: true,
    coveredByRetainer: false,
    description: '',
    documentNo: '',
    documentDate: '',
    supplierName: '',
    receiptPath: '',
  };
}

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'blue' | 'orange' | 'muted';
}

function MetricCard({ label, value, detail, icon: Icon, tone }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-[var(--secondary)]">{label}</p>
            <p className="mt-1 text-xl font-semibold text-[var(--text)]">{value}</p>
            <p className="mt-1 text-xs text-[var(--secondary)]">{detail}</p>
          </div>
          <div
            className={cn(
              'inline-flex h-10 w-10 items-center justify-center rounded-xl',
              tone === 'blue' && 'bg-[color-mix(in_srgb,var(--primary),white_88%)] text-[var(--primary)]',
              tone === 'orange' && 'bg-[color-mix(in_srgb,var(--warning),white_88%)] text-[var(--warning)]',
              tone === 'muted' && 'bg-[color-mix(in_srgb,var(--border),white_55%)] text-[var(--secondary)]',
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TimeBillingCollectionPage() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [bootstrap, setBootstrap] = useState<FinanceBootstrapResponse | null>(null);
  const [overview, setOverview] = useState<FinanceOverviewResponse | null>(null);

  const [timeEntries, setTimeEntries] = useState<FinanceTimeEntry[]>([]);
  const [expenses, setExpenses] = useState<FinanceExpense[]>([]);
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([]);
  const [payments, setPayments] = useState<FinancePayment[]>([]);
  const [paymentLinks, setPaymentLinks] = useState<FinancePaymentLink[]>([]);
  const [proposals, setProposals] = useState<FinanceProposal[]>([]);
  const [contracts, setContracts] = useState<FinanceContract[]>([]);
  const [retainers, setRetainers] = useState<FinanceRetainer[]>([]);
  const [taxSummaries, setTaxSummaries] = useState<FinanceTaxSummary[]>([]);
  const [activePanel, setActivePanel] = useState<'tracking' | 'billing' | 'retainers' | 'insights'>('tracking');

  const [filters, setFilters] = useState<FiltersState>({
    caseId: '',
    clientId: '',
    dateFrom: firstDayOfMonth(),
    dateTo: today(),
  });
  const [caseSearch, setCaseSearch] = useState('');
  const [clientSearch, setClientSearch] = useState('');

  const [timeForm, setTimeForm] = useState<TimeFormState>(defaultTimeForm(null, '', '', ''));
  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>(defaultExpenseForm('', '', ''));

  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerStartedAt, setTimerStartedAt] = useState<string | null>(null);
  const [timerNote, setTimerNote] = useState('');

  const [invoiceForm, setInvoiceForm] = useState({
    caseId: '',
    clientId: '',
    responsibleUserId: '',
    proposalId: '',
    contractId: '',
    billingModel: 'hourly' as FinanceInvoice['billingModel'],
    invoiceDate: today(),
    dueDate: today(),
    vatRate: '20',
    withholdingRate: '0',
    discountTotal: '0',
    autoIncludeUnbilledTime: true,
    autoIncludeUnbilledExpenses: true,
    manualAmount: '',
    manualItemDescription: '',
    description: '',
  });

  const [proposalForm, setProposalForm] = useState({
    caseId: '',
    clientId: '',
    billingModel: 'hourly' as FinanceProposal['billingModel'],
    proposalDate: today(),
    validUntil: '',
    fixedFeeAmount: '',
    hourlyRate: '',
    successFeeRate: '',
    retainerAmount: '',
    status: 'draft' as FinanceProposal['status'],
    notes: '',
  });

  const [contractForm, setContractForm] = useState({
    caseId: '',
    clientId: '',
    proposalId: '',
    billingModel: 'hourly' as FinanceContract['billingModel'],
    signedAt: today(),
    startsAt: '',
    endsAt: '',
    fixedFeeAmount: '',
    hourlyRate: '',
    successFeeRate: '',
    monthlyRetainerAmount: '',
    status: 'draft' as FinanceContract['status'],
    terms: '',
  });

  const [paymentForm, setPaymentForm] = useState({
    invoiceId: '',
    caseId: '',
    clientId: '',
    paymentDate: today(),
    amount: '',
    paymentMethod: 'wire' as FinancePaymentMethod,
    referenceNo: '',
    note: '',
  });

  const [paymentLinkForm, setPaymentLinkForm] = useState({
    invoiceId: '',
    caseId: '',
    clientId: '',
    provider: 'manual-provider',
    amount: '',
    linkType: 'invoice' as FinancePaymentLink['linkType'],
    expiresAt: '',
    note: '',
  });

  const [retainerForm, setRetainerForm] = useState({
    caseId: '',
    clientId: '',
    contractId: '',
    retainerType: 'service' as FinanceRetainerType,
    receivedDate: today(),
    amount: '',
    refundableAmount: '0',
    note: '',
  });

  const [retainerAllocationForm, setRetainerAllocationForm] = useState({
    retainerId: '',
    amount: '',
    allocationDate: today(),
    invoiceId: '',
    expenseId: '',
    note: '',
  });

  const [taxConfigForm, setTaxConfigForm] = useState({
    vatRate: '20',
    withholdingRate: '20',
    estimatedIncomeTaxRate: '25',
    minBillingMinutes: '6',
    billingRoundingMinutes: '6',
    defaultCurrency: 'TRY',
  });

  const [taxSummaryForm, setTaxSummaryForm] = useState({
    periodType: 'monthly' as FinanceTaxSummary['periodType'],
    periodStart: firstDayOfMonth(),
    periodEnd: today(),
  });

  const notify = useCallback((message: string, type: Notice['type'] = 'success') => {
    setNotice({ type, message });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      setTimerSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  const filteredCases = useMemo(() => {
    const all = bootstrap?.cases ?? [];
    const query = caseSearch.trim().toLowerCase();
    if (!query) return all;
    return all.filter((item) => `${item.title} ${item.fileNo ?? ''} ${item.clientDisplayName ?? ''}`.toLowerCase().includes(query));
  }, [bootstrap?.cases, caseSearch]);

  const filteredClients = useMemo(() => {
    const all = bootstrap?.clients ?? [];
    const query = clientSearch.trim().toLowerCase();
    if (!query) return all;
    return all.filter((item) => `${item.fullName} ${item.fileNo ?? ''} ${item.publicRefCode ?? ''}`.toLowerCase().includes(query));
  }, [bootstrap?.clients, clientSearch]);

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => invoice.id === paymentForm.invoiceId) ?? null,
    [invoices, paymentForm.invoiceId],
  );

  const applyDefaultFormScope = useCallback(
    (scope: FinanceBootstrapResponse, config: FinanceTaxConfig | null, nextFilters: FiltersState) => {
      const defaultUser = scope.teamMembers[0]?.id ?? '';
      const defaultCase = nextFilters.caseId || scope.cases[0]?.id || '';
      const defaultClient = nextFilters.clientId || scope.clients[0]?.id || '';

      setTimeForm(defaultTimeForm(config, defaultUser, defaultCase, defaultClient));
      setExpenseForm(defaultExpenseForm(defaultUser, defaultCase, defaultClient));
      setInvoiceForm((prev) => ({
        ...prev,
        caseId: defaultCase,
        clientId: defaultClient,
        responsibleUserId: defaultUser,
      }));
      setProposalForm((prev) => ({
        ...prev,
        caseId: defaultCase,
        clientId: defaultClient,
      }));
      setContractForm((prev) => ({
        ...prev,
        caseId: defaultCase,
        clientId: defaultClient,
      }));
      setPaymentForm((prev) => ({
        ...prev,
        caseId: defaultCase,
        clientId: defaultClient,
      }));
      setPaymentLinkForm((prev) => ({
        ...prev,
        caseId: defaultCase,
        clientId: defaultClient,
      }));
      setRetainerForm((prev) => ({
        ...prev,
        caseId: defaultCase,
        clientId: defaultClient,
      }));
    },
    [],
  );

  const loadAll = useCallback(
    async (nextFilters: FiltersState) => {
      const query = {
        caseId: nextFilters.caseId || undefined,
        clientId: nextFilters.clientId || undefined,
        dateFrom: nextFilters.dateFrom || undefined,
        dateTo: nextFilters.dateTo || undefined,
      };

      const [overviewData, timeData, expenseData, invoiceData, paymentData, paymentLinkData, proposalData, contractData, retainerData, taxSummaryData, taxConfigData] =
        await Promise.all([
          getFinanceOverview(),
          listTimeEntries(query),
          listExpenses(query),
          listInvoices({
            caseId: query.caseId,
            clientId: query.clientId,
          }),
          listPayments(query),
          listPaymentLinks({
            caseId: query.caseId,
            clientId: query.clientId,
          }),
          listProposals({
            caseId: query.caseId,
            clientId: query.clientId,
          }),
          listContracts({
            caseId: query.caseId,
            clientId: query.clientId,
          }),
          listRetainers({
            caseId: query.caseId,
            clientId: query.clientId,
          }),
          listTaxSummaries({}),
          getTaxConfig(),
        ]);

      setOverview(overviewData);
      setTimeEntries(timeData);
      setExpenses(expenseData);
      setInvoices(invoiceData);
      setPayments(paymentData);
      setPaymentLinks(paymentLinkData);
      setProposals(proposalData);
      setContracts(contractData);
      setRetainers(retainerData);
      setTaxSummaries(taxSummaryData);
      setTaxConfigForm({
        vatRate: String(taxConfigData.vatRate),
        withholdingRate: String(taxConfigData.withholdingRate),
        estimatedIncomeTaxRate: String(taxConfigData.estimatedIncomeTaxRate),
        minBillingMinutes: String(taxConfigData.minBillingMinutes),
        billingRoundingMinutes: String(taxConfigData.billingRoundingMinutes),
        defaultCurrency: taxConfigData.defaultCurrency,
      });
    },
    [],
  );

  useEffect(() => {
    let active = true;
    async function initialize() {
      setLoading(true);
      try {
        const scope = await getFinanceBootstrap();
        if (!active) return;
        setBootstrap(scope);

        const initialFilters: FiltersState = {
          caseId: '',
          clientId: '',
          dateFrom: firstDayOfMonth(),
          dateTo: today(),
        };
        setFilters(initialFilters);
        applyDefaultFormScope(scope, scope.taxConfig, initialFilters);

        await loadAll(initialFilters);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Finans paneli baslatilamadi.';
        if (active) {
          notify(message, 'error');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, [applyDefaultFormScope, loadAll, notify]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await loadAll(filters);
      notify('Veriler guncellendi.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Veriler guncellenemedi.';
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [filters, loadAll, notify]);

  const handleApplyFilters = useCallback(async () => {
    setBusy(true);
    try {
      await loadAll(filters);
      notify('Filtreler uygulandi.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Filtreleme basarisiz.';
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [filters, loadAll, notify]);

  const handleSaveTime = useCallback(
    async (source: 'manual' | 'timer', durationOverride?: number, startedAt?: string | null, endedAt?: string | null) => {
      const duration = durationOverride ?? parseAmount(timeForm.durationMinutes);
      if (!Number.isFinite(duration) || duration <= 0) {
        notify('Sure dakika degeri gecersiz.', 'error');
        return;
      }

      const payload = {
        id: timeForm.id || undefined,
        caseId: timeForm.caseId || null,
        clientId: timeForm.clientId || null,
        responsibleUserId: timeForm.responsibleUserId || null,
        workType: timeForm.workType,
        source,
        workDate: timeForm.workDate,
        durationMinutes: duration,
        minBillingMinutes: parseAmount(timeForm.minBillingMinutes),
        roundingMinutes: parseAmount(timeForm.roundingMinutes),
        billable: timeForm.billable,
        internalHourlyCost: parseAmount(timeForm.internalHourlyCost),
        salesHourlyRate: parseAmount(timeForm.salesHourlyRate),
        note: source === 'timer' ? timerNote.trim() || null : timeForm.note.trim() || null,
        startedAt: startedAt || null,
        endedAt: endedAt || null,
      };

      setBusy(true);
      try {
        if (timeForm.id) {
          await updateTimeEntry(payload);
          notify('Sure kaydi guncellendi.');
        } else {
          await createTimeEntry(payload);
          notify('Sure kaydi olusturuldu.');
        }

        setTimeForm((prev) => ({ ...prev, id: '', durationMinutes: '30', note: '' }));
        setTimerRunning(false);
        setTimerSeconds(0);
        setTimerStartedAt(null);
        setTimerNote('');
        await loadAll(filters);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sure kaydi kaydedilemedi.';
        notify(message, 'error');
      } finally {
        setBusy(false);
      }
    },
    [filters, loadAll, notify, timeForm, timerNote],
  );

  const handleDeleteTime = useCallback(
    async (id: string) => {
      if (!window.confirm('Sure kaydini silmek istediginize emin misiniz?')) return;
      setBusy(true);
      try {
        await deleteTimeEntry(id);
        notify('Sure kaydi silindi.');
        await loadAll(filters);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sure kaydi silinemedi.';
        notify(message, 'error');
      } finally {
        setBusy(false);
      }
    },
    [filters, loadAll, notify],
  );

  const handleSaveExpense = useCallback(async () => {
    const amount = parseAmount(expenseForm.amount);
    const vatRate = parseAmount(expenseForm.vatRate);
    if (!Number.isFinite(amount) || amount <= 0) {
      notify('Masraf tutari gecersiz.', 'error');
      return;
    }
    if (!Number.isFinite(vatRate) || vatRate < 0) {
      notify('KDV orani gecersiz.', 'error');
      return;
    }

    const payload = {
      id: expenseForm.id || undefined,
      caseId: expenseForm.caseId || null,
      clientId: expenseForm.clientId || null,
      responsibleUserId: expenseForm.responsibleUserId || null,
      category: expenseForm.category,
      expenseDate: expenseForm.expenseDate,
      amount,
      vatRate,
      vatIncluded: expenseForm.vatIncluded,
      billableToClient: expenseForm.billableToClient,
      coveredByRetainer: expenseForm.coveredByRetainer,
      description: expenseForm.description.trim() || null,
      documentNo: expenseForm.documentNo.trim() || null,
      documentDate: expenseForm.documentDate || null,
      supplierName: expenseForm.supplierName.trim() || null,
      receiptPath: expenseForm.receiptPath.trim() || null,
      currency: 'TRY',
    };

    setBusy(true);
    try {
      if (expenseForm.id) {
        await updateExpense(payload);
        notify('Masraf kaydi guncellendi.');
      } else {
        await createExpense(payload);
        notify('Masraf kaydi olusturuldu.');
      }
      setExpenseForm((prev) => ({ ...prev, id: '', amount: '', description: '' }));
      await loadAll(filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Masraf kaydi kaydedilemedi.';
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [expenseForm, filters, loadAll, notify]);

  const handleDeleteExpense = useCallback(
    async (id: string) => {
      if (!window.confirm('Masraf kaydini silmek istediginize emin misiniz?')) return;
      setBusy(true);
      try {
        await deleteExpense(id);
        notify('Masraf kaydi silindi.');
        await loadAll(filters);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Masraf silinemedi.';
        notify(message, 'error');
      } finally {
        setBusy(false);
      }
    },
    [filters, loadAll, notify],
  );

  const handleCreateProposal = useCallback(async () => {
    setBusy(true);
    try {
      await createProposal({
        caseId: proposalForm.caseId || null,
        clientId: proposalForm.clientId || null,
        billingModel: proposalForm.billingModel,
        proposalDate: proposalForm.proposalDate,
        validUntil: proposalForm.validUntil || null,
        fixedFeeAmount: proposalForm.fixedFeeAmount ? parseAmount(proposalForm.fixedFeeAmount) : null,
        hourlyRate: proposalForm.hourlyRate ? parseAmount(proposalForm.hourlyRate) : null,
        successFeeRate: proposalForm.successFeeRate ? parseAmount(proposalForm.successFeeRate) : null,
        retainerAmount: proposalForm.retainerAmount ? parseAmount(proposalForm.retainerAmount) : null,
        status: proposalForm.status,
        notes: proposalForm.notes.trim() || null,
      });
      notify('Teklif olusturuldu.');
      setProposalForm((prev) => ({ ...prev, notes: '', fixedFeeAmount: '', hourlyRate: '', successFeeRate: '', retainerAmount: '' }));
      await loadAll(filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Teklif olusturulamadi.';
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [filters, loadAll, notify, proposalForm]);

  const handleCreateContract = useCallback(async () => {
    setBusy(true);
    try {
      await createContract({
        caseId: contractForm.caseId || null,
        clientId: contractForm.clientId || null,
        proposalId: contractForm.proposalId || null,
        billingModel: contractForm.billingModel,
        signedAt: contractForm.signedAt || null,
        startsAt: contractForm.startsAt || null,
        endsAt: contractForm.endsAt || null,
        fixedFeeAmount: contractForm.fixedFeeAmount ? parseAmount(contractForm.fixedFeeAmount) : null,
        hourlyRate: contractForm.hourlyRate ? parseAmount(contractForm.hourlyRate) : null,
        successFeeRate: contractForm.successFeeRate ? parseAmount(contractForm.successFeeRate) : null,
        monthlyRetainerAmount: contractForm.monthlyRetainerAmount ? parseAmount(contractForm.monthlyRetainerAmount) : null,
        status: contractForm.status,
        terms: contractForm.terms.trim() || null,
      });
      notify('Sozlesme olusturuldu.');
      setContractForm((prev) => ({
        ...prev,
        fixedFeeAmount: '',
        hourlyRate: '',
        successFeeRate: '',
        monthlyRetainerAmount: '',
        terms: '',
      }));
      await loadAll(filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sozlesme olusturulamadi.';
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [contractForm, filters, loadAll, notify]);

  const handleCreateInvoice = useCallback(async () => {
    const vatRate = parseAmount(invoiceForm.vatRate);
    const withholdingRate = parseAmount(invoiceForm.withholdingRate);
    const discountTotal = parseAmount(invoiceForm.discountTotal);
    if (!Number.isFinite(vatRate) || vatRate < 0 || !Number.isFinite(withholdingRate) || withholdingRate < 0) {
      notify('Vergi alanlari gecersiz.', 'error');
      return;
    }

    setBusy(true);
    try {
      const created = await createInvoice({
        caseId: invoiceForm.caseId || null,
        clientId: invoiceForm.clientId || null,
        responsibleUserId: invoiceForm.responsibleUserId || null,
        proposalId: invoiceForm.proposalId || null,
        contractId: invoiceForm.contractId || null,
        billingModel: invoiceForm.billingModel,
        invoiceDate: invoiceForm.invoiceDate,
        dueDate: invoiceForm.dueDate || null,
        vatRate,
        withholdingRate,
        discountTotal: Number.isFinite(discountTotal) ? discountTotal : 0,
        autoIncludeUnbilledTime: invoiceForm.autoIncludeUnbilledTime,
        autoIncludeUnbilledExpenses: invoiceForm.autoIncludeUnbilledExpenses,
        manualAmount: invoiceForm.manualAmount ? parseAmount(invoiceForm.manualAmount) : undefined,
        manualItemDescription: invoiceForm.manualItemDescription || undefined,
        description: invoiceForm.description.trim() || null,
        status: 'issued',
      });

      notify('Fatura olusturuldu.');
      setPaymentForm((prev) => ({
        ...prev,
        invoiceId: created.id,
        caseId: created.caseId ?? '',
        clientId: created.clientId ?? '',
        amount: String(created.amountDue),
      }));
      setInvoiceForm((prev) => ({
        ...prev,
        manualAmount: '',
        manualItemDescription: '',
        description: '',
      }));
      await loadAll(filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fatura olusturulamadi.';
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [filters, invoiceForm, loadAll, notify]);

  const handleRecordReminder = useCallback(
    async (invoiceId: string) => {
      setBusy(true);
      try {
        await updateInvoice({
          id: invoiceId,
          recordReminder: true,
          reminderNote: 'Panel uzerinden otomatik hatirlatma kaydi',
        });
        notify('Hatirlatma kaydi olusturuldu.');
        await loadAll(filters);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Hatirlatma kaydi olusturulamadi.';
        notify(message, 'error');
      } finally {
        setBusy(false);
      }
    },
    [filters, loadAll, notify],
  );

  const handleCreatePayment = useCallback(async () => {
    const amount = parseAmount(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      notify('Tahsilat tutari gecersiz.', 'error');
      return;
    }

    setBusy(true);
    try {
      await createPayment({
        invoiceId: paymentForm.invoiceId || null,
        caseId: paymentForm.caseId || null,
        clientId: paymentForm.clientId || null,
        paymentDate: paymentForm.paymentDate,
        amount,
        paymentMethod: paymentForm.paymentMethod,
        referenceNo: paymentForm.referenceNo.trim() || null,
        note: paymentForm.note.trim() || null,
      });
      notify('Tahsilat kaydi olusturuldu.');
      setPaymentForm((prev) => ({
        ...prev,
        amount: '',
        referenceNo: '',
        note: '',
      }));
      await loadAll(filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tahsilat kaydedilemedi.';
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [filters, loadAll, notify, paymentForm]);

  const handleDeletePayment = useCallback(
    async (id: string) => {
      if (!window.confirm('Tahsilat kaydini silmek istediginize emin misiniz?')) return;
      setBusy(true);
      try {
        await deletePayment(id);
        notify('Tahsilat kaydi silindi.');
        await loadAll(filters);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Tahsilat silinemedi.';
        notify(message, 'error');
      } finally {
        setBusy(false);
      }
    },
    [filters, loadAll, notify],
  );

  const handleCreatePaymentLink = useCallback(async () => {
    const amount = parseAmount(paymentLinkForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      notify('Odeme linki tutari gecersiz.', 'error');
      return;
    }

    setBusy(true);
    try {
      await createPaymentLink({
        invoiceId: paymentLinkForm.invoiceId || null,
        caseId: paymentLinkForm.caseId || null,
        clientId: paymentLinkForm.clientId || null,
        provider: paymentLinkForm.provider.trim(),
        amount,
        linkType: paymentLinkForm.linkType,
        expiresAt: paymentLinkForm.expiresAt ? new Date(`${paymentLinkForm.expiresAt}T23:59:59Z`).toISOString() : null,
        note: paymentLinkForm.note.trim() || null,
      });
      notify('Odeme linki olusturuldu.');
      setPaymentLinkForm((prev) => ({ ...prev, amount: '', note: '' }));
      await loadAll(filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Odeme linki olusturulamadi.';
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [filters, loadAll, notify, paymentLinkForm]);

  const handleUpdatePaymentLinkStatus = useCallback(
    async (id: string, status: FinancePaymentLinkStatus) => {
      setBusy(true);
      try {
        await updatePaymentLink({
          id,
          status,
          markWebhookTouched: true,
        });
        notify('Odeme linki durumu guncellendi.');
        await loadAll(filters);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Odeme linki guncellenemedi.';
        notify(message, 'error');
      } finally {
        setBusy(false);
      }
    },
    [filters, loadAll, notify],
  );

  const handleCreateRetainer = useCallback(async () => {
    const amount = parseAmount(retainerForm.amount);
    const refundableAmount = parseAmount(retainerForm.refundableAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      notify('Avans tutari gecersiz.', 'error');
      return;
    }

    setBusy(true);
    try {
      await createRetainer({
        caseId: retainerForm.caseId || null,
        clientId: retainerForm.clientId || null,
        contractId: retainerForm.contractId || null,
        retainerType: retainerForm.retainerType,
        receivedDate: retainerForm.receivedDate,
        amount,
        refundableAmount: Number.isFinite(refundableAmount) ? refundableAmount : 0,
        note: retainerForm.note.trim() || null,
      });
      notify('Avans kaydi olusturuldu.');
      setRetainerForm((prev) => ({ ...prev, amount: '', note: '' }));
      await loadAll(filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Avans kaydi olusturulamadi.';
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [filters, loadAll, notify, retainerForm]);

  const handleAllocateRetainer = useCallback(async () => {
    const amount = parseAmount(retainerAllocationForm.amount);
    if (!retainerAllocationForm.retainerId) {
      notify('Mahsup icin avans secin.', 'error');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      notify('Mahsup tutari gecersiz.', 'error');
      return;
    }

    setBusy(true);
    try {
      await updateRetainer({
        id: retainerAllocationForm.retainerId,
        allocation: {
          amount,
          allocationDate: retainerAllocationForm.allocationDate,
          invoiceId: retainerAllocationForm.invoiceId || null,
          expenseId: retainerAllocationForm.expenseId || null,
          note: retainerAllocationForm.note.trim() || null,
        },
      });
      notify('Avans mahsup islemi kaydedildi.');
      setRetainerAllocationForm((prev) => ({
        ...prev,
        amount: '',
        invoiceId: '',
        expenseId: '',
        note: '',
      }));
      await loadAll(filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Avans mahsup edilemedi.';
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [filters, loadAll, notify, retainerAllocationForm]);

  const handleSaveTaxConfig = useCallback(async () => {
    setBusy(true);
    try {
      await updateTaxConfig({
        vatRate: parseAmount(taxConfigForm.vatRate),
        withholdingRate: parseAmount(taxConfigForm.withholdingRate),
        estimatedIncomeTaxRate: parseAmount(taxConfigForm.estimatedIncomeTaxRate),
        minBillingMinutes: parseAmount(taxConfigForm.minBillingMinutes),
        billingRoundingMinutes: parseAmount(taxConfigForm.billingRoundingMinutes),
        defaultCurrency: taxConfigForm.defaultCurrency.trim() || 'TRY',
      });
      notify('Vergi ayarlari guncellendi.');
      await loadAll(filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Vergi ayarlari guncellenemedi.';
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [filters, loadAll, notify, taxConfigForm]);

  const handleCreateTaxSummary = useCallback(async () => {
    setBusy(true);
    try {
      await createTaxSummary({
        periodType: taxSummaryForm.periodType,
        periodStart: taxSummaryForm.periodStart,
        periodEnd: taxSummaryForm.periodEnd,
      });
      notify('Vergi ozeti olusturuldu.');
      await loadAll(filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Vergi ozeti olusturulamadi.';
      notify(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [filters, loadAll, notify, taxSummaryForm]);

  const totalTrackedMinutes = useMemo(() => timeEntries.reduce((sum, row) => sum + row.durationMinutes, 0), [timeEntries]);
  const totalExpense = useMemo(() => expenses.reduce((sum, row) => sum + row.grossAmount, 0), [expenses]);
  const totalInvoiced = useMemo(() => invoices.reduce((sum, row) => sum + row.totalAmount, 0), [invoices]);
  const pendingCollection = useMemo(() => invoices.reduce((sum, row) => sum + row.amountDue, 0), [invoices]);

  if (loading) {
    return (
      <section className="space-y-4">
        <Card>
          <CardContent className="p-6 text-sm text-[var(--secondary)]">Finans paneli yukleniyor...</CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <Card glass className="overflow-hidden">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="blue">Gercek API + DB</Badge>
            </div>
            <Button variant="outline" onClick={refresh} disabled={busy}>
              <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} />
              Yenile
            </Button>
          </div>
          <CardTitle className="text-2xl">Finans ve Operasyon</CardTitle>
          <CardDescription>
            Sade gorunumde modulleri tek tek yonet. Tum veriler gercek API ve veritabanindan gelir.
          </CardDescription>
          {notice ? (
            <p
              className={cn(
                'rounded-xl border px-3 py-2 text-sm',
                notice.type === 'success'
                  ? 'border-[color-mix(in_srgb,var(--success),white_55%)] bg-[color-mix(in_srgb,var(--success),white_91%)] text-[var(--success)]'
                  : 'border-[color-mix(in_srgb,var(--error),white_55%)] bg-[color-mix(in_srgb,var(--error),white_92%)] text-[var(--error)]',
              )}
            >
              {notice.message}
            </p>
          ) : null}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtreler ve Arama</CardTitle>
          <CardDescription>Muvekkil/dosya bazli filtreleyip tum modulleri ayni kapsamda yonetebilirsin.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-6">
          <Input value={caseSearch} onChange={(event) => setCaseSearch(event.target.value)} placeholder="Dosya ara" />
          <Input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Muvekkil ara" />
          <select
            value={filters.caseId}
            onChange={(event) => setFilters((prev) => ({ ...prev, caseId: event.target.value }))}
            className={SELECT_CLASSNAME}
          >
            <option value="">Tum dosyalar</option>
            {filteredCases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <select
            value={filters.clientId}
            onChange={(event) => setFilters((prev) => ({ ...prev, clientId: event.target.value }))}
            className={SELECT_CLASSNAME}
          >
            <option value="">Tum muvekkiller</option>
            {filteredClients.map((item) => (
              <option key={item.id} value={item.id}>
                {item.fullName}
              </option>
            ))}
          </select>
          <Input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
          />
          <div className="flex gap-2">
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
            />
            <Button onClick={handleApplyFilters} disabled={busy}>
              Uygula
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-4">
        <MetricCard
          label="Bu Ay Tahsilat"
          value={formatMoney(overview?.cards.collectedThisMonth ?? 0)}
          detail={`${payments.length} tahsilat`}
          icon={Wallet}
          tone="blue"
        />
        <MetricCard
          label="Bu Ay Fatura"
          value={formatMoney(overview?.cards.invoicedThisMonth ?? 0)}
          detail={`${invoices.length} fatura`}
          icon={CircleDollarSign}
          tone="blue"
        />
        <MetricCard
          label="Faturalanmamis Emek"
          value={formatMoney(overview?.cards.unbilledTimeAmount ?? 0)}
          detail={formatDuration(totalTrackedMinutes)}
          icon={Clock3}
          tone="orange"
        />
        <MetricCard
          label="Bekleyen Tahsilat"
          value={formatMoney(overview?.cards.pendingCollection ?? pendingCollection)}
          detail={`${invoices.filter((row) => row.status === 'overdue').length} gecikmis`}
          icon={ReceiptText}
          tone="muted"
        />
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2">
            <Button variant={activePanel === 'tracking' ? 'default' : 'outline'} onClick={() => setActivePanel('tracking')}>
              Sure ve Masraf
            </Button>
            <Button variant={activePanel === 'billing' ? 'default' : 'outline'} onClick={() => setActivePanel('billing')}>
              Fatura ve Tahsilat
            </Button>
            <Button variant={activePanel === 'retainers' ? 'default' : 'outline'} onClick={() => setActivePanel('retainers')}>
              Avans ve Vergi
            </Button>
            <Button variant={activePanel === 'insights' ? 'default' : 'outline'} onClick={() => setActivePanel('insights')}>
              Rapor ve Risk
            </Button>
          </div>
        </CardContent>
      </Card>

      {activePanel === 'tracking' ? <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1) Time Tracking</CardTitle>
            <CardDescription>Manuel giris ve kronometre ile sure kaydi, duzenleme ve silme.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <select
                value={timeForm.caseId}
                onChange={(event) => setTimeForm((prev) => ({ ...prev, caseId: event.target.value }))}
                className={SELECT_CLASSNAME}
              >
                <option value="">Dosya secin</option>
                {(bootstrap?.cases ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <select
                value={timeForm.clientId}
                onChange={(event) => setTimeForm((prev) => ({ ...prev, clientId: event.target.value }))}
                className={SELECT_CLASSNAME}
              >
                <option value="">Muvekkil secin</option>
                {(bootstrap?.clients ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <select
                value={timeForm.workType}
                onChange={(event) => setTimeForm((prev) => ({ ...prev, workType: event.target.value as FinanceWorkType }))}
                className={SELECT_CLASSNAME}
              >
                {Object.entries(WORK_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <Input
                type="date"
                value={timeForm.workDate}
                onChange={(event) => setTimeForm((prev) => ({ ...prev, workDate: event.target.value }))}
              />
              <Input
                value={timeForm.durationMinutes}
                onChange={(event) => setTimeForm((prev) => ({ ...prev, durationMinutes: event.target.value }))}
                placeholder="Dakika"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Input
                value={timeForm.internalHourlyCost}
                onChange={(event) => setTimeForm((prev) => ({ ...prev, internalHourlyCost: event.target.value }))}
                placeholder="Saatlik ic maliyet"
              />
              <Input
                value={timeForm.salesHourlyRate}
                onChange={(event) => setTimeForm((prev) => ({ ...prev, salesHourlyRate: event.target.value }))}
                placeholder="Saatlik satis bedeli"
              />
              <div className="flex items-center gap-2 rounded-xl border border-[var(--main-border,var(--border))] px-3">
                <input
                  id="billable-toggle"
                  type="checkbox"
                  checked={timeForm.billable}
                  onChange={(event) => setTimeForm((prev) => ({ ...prev, billable: event.target.checked }))}
                />
                <label htmlFor="billable-toggle" className="text-sm text-[var(--text)]">
                  Faturalanabilir
                </label>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={timeForm.minBillingMinutes}
                onChange={(event) => setTimeForm((prev) => ({ ...prev, minBillingMinutes: event.target.value }))}
                placeholder="Min fatura dakika"
              />
              <Input
                value={timeForm.roundingMinutes}
                onChange={(event) => setTimeForm((prev) => ({ ...prev, roundingMinutes: event.target.value }))}
                placeholder="Yuvarlama dakika"
              />
            </div>
            <Textarea
              rows={2}
              value={timeForm.note}
              onChange={(event) => setTimeForm((prev) => ({ ...prev, note: event.target.value }))}
              placeholder="Calisma notu"
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void handleSaveTime('manual')} disabled={busy}>
                <AlarmClockPlus className="h-4 w-4" />
                {timeForm.id ? 'Kaydi Guncelle' : 'Manuel Sure Ekle'}
              </Button>
              {timeForm.id ? (
                <Button
                  variant="outline"
                  onClick={() => setTimeForm(defaultTimeForm(null, timeForm.responsibleUserId, timeForm.caseId, timeForm.clientId))}
                >
                  Duzenlemeyi Iptal
                </Button>
              ) : null}
            </div>

            <div className="rounded-xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] p-3 space-y-3">
              <p className="text-sm font-medium text-[var(--text)]">Kronometre</p>
              <Input value={timerNote} onChange={(event) => setTimerNote(event.target.value)} placeholder="Kronometre notu" />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <p className="min-w-[112px] rounded-xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-3,var(--surface))] px-3 py-2 text-center font-mono text-lg font-semibold text-[var(--text)]">
                  {formatStopwatch(timerSeconds)}
                </p>
                {!timerRunning ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setTimerStartedAt(new Date().toISOString());
                      setTimerRunning(true);
                    }}
                  >
                    <Play className="h-4 w-4" />
                    Baslat
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setTimerRunning(false)}>
                    <Pause className="h-4 w-4" />
                    Durdur
                  </Button>
                )}
                <Button
                  onClick={() =>
                    void handleSaveTime(
                      'timer',
                      Math.max(Number((timerSeconds / 60).toFixed(2)), 0.1),
                      timerStartedAt,
                      new Date().toISOString(),
                    )
                  }
                  disabled={timerSeconds <= 0 || busy}
                >
                  Kaydet
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setTimerRunning(false);
                    setTimerSeconds(0);
                    setTimerStartedAt(null);
                  }}
                >
                  Sifirla
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text)]">Son Sure Kayitlari</p>
              {timeEntries.length === 0 ? (
                <p className="text-sm text-[var(--secondary)]">Sure kaydi bulunmuyor.</p>
              ) : (
                <ul className="space-y-2">
                  {timeEntries.slice(0, 8).map((entry) => (
                    <li key={entry.id} className="rounded-lg border border-[var(--main-border,var(--border))] px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-[var(--text)]">{WORK_TYPE_LABELS[entry.workType]}</p>
                          <p className="text-xs text-[var(--secondary)]">{entry.note ?? '-'}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-[var(--text)]">{formatDuration(entry.durationMinutes)}</p>
                          <p className="text-xs text-[var(--secondary)]">{formatDate(entry.workDate)}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setTimeForm({
                              id: entry.id,
                              caseId: entry.caseId ?? '',
                              clientId: entry.clientId ?? '',
                              responsibleUserId: entry.responsibleUserId ?? '',
                              workType: entry.workType,
                              workDate: entry.workDate,
                              durationMinutes: String(entry.durationMinutes),
                              minBillingMinutes: String(entry.minBillingMinutes),
                              roundingMinutes: String(entry.roundingMinutes),
                              billable: entry.billable,
                              internalHourlyCost: String(entry.internalHourlyCost),
                              salesHourlyRate: String(entry.salesHourlyRate),
                              note: entry.note ?? '',
                            })
                          }
                        >
                          Duzenle
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void handleDeleteTime(entry.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          Sil
                        </Button>
                        {entry.invoiceId ? <Badge variant="blue">Faturaya Bagli</Badge> : <Badge variant="muted">Faturalanmamis</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">2) Masraf Takibi</CardTitle>
            <CardDescription>Masraf kaydet, duzenle, sil ve yansitilabilirlik durumunu yonet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <select
                value={expenseForm.caseId}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, caseId: event.target.value }))}
                className={SELECT_CLASSNAME}
              >
                <option value="">Dosya secin</option>
                {(bootstrap?.cases ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <select
                value={expenseForm.clientId}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, clientId: event.target.value }))}
                className={SELECT_CLASSNAME}
              >
                <option value="">Muvekkil secin</option>
                {(bootstrap?.clients ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <select
                value={expenseForm.category}
                onChange={(event) =>
                  setExpenseForm((prev) => ({ ...prev, category: event.target.value as FinanceExpenseCategory }))
                }
                className={SELECT_CLASSNAME}
              >
                {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <Input
                type="date"
                value={expenseForm.expenseDate}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, expenseDate: event.target.value }))}
              />
              <Input
                value={expenseForm.amount}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, amount: event.target.value }))}
                placeholder="Tutar"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Input
                value={expenseForm.vatRate}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, vatRate: event.target.value }))}
                placeholder="KDV %"
              />
              <Input
                value={expenseForm.documentNo}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, documentNo: event.target.value }))}
                placeholder="Belge no"
              />
              <Input
                type="date"
                value={expenseForm.documentDate}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, documentDate: event.target.value }))}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={expenseForm.supplierName}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, supplierName: event.target.value }))}
                placeholder="Tedarikci / kurum"
              />
              <Input
                value={expenseForm.receiptPath}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, receiptPath: event.target.value }))}
                placeholder="Belge dosya yolu"
              />
            </div>
            <Textarea
              rows={2}
              value={expenseForm.description}
              onChange={(event) => setExpenseForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Aciklama"
            />
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="flex items-center gap-2 rounded-xl border border-[var(--main-border,var(--border))] px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={expenseForm.vatIncluded}
                  onChange={(event) => setExpenseForm((prev) => ({ ...prev, vatIncluded: event.target.checked }))}
                />
                KDV dahil
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-[var(--main-border,var(--border))] px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={expenseForm.billableToClient}
                  onChange={(event) => setExpenseForm((prev) => ({ ...prev, billableToClient: event.target.checked }))}
                />
                Muvekkile yansit
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-[var(--main-border,var(--border))] px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={expenseForm.coveredByRetainer}
                  onChange={(event) => setExpenseForm((prev) => ({ ...prev, coveredByRetainer: event.target.checked }))}
                />
                Avanstan karsilandi
              </label>
            </div>
            <Button onClick={() => void handleSaveExpense()} disabled={busy}>
              <Save className="h-4 w-4" />
              {expenseForm.id ? 'Masrafi Guncelle' : 'Masraf Ekle'}
            </Button>

            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text)]">Son Masraflar</p>
              {expenses.length === 0 ? (
                <p className="text-sm text-[var(--secondary)]">Masraf kaydi yok.</p>
              ) : (
                <ul className="space-y-2">
                  {expenses.slice(0, 8).map((entry) => (
                    <li key={entry.id} className="rounded-lg border border-[var(--main-border,var(--border))] px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-[var(--text)]">{EXPENSE_CATEGORY_LABELS[entry.category]}</p>
                          <p className="text-xs text-[var(--secondary)]">{entry.description ?? '-'}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-[var(--text)]">{formatMoney(entry.grossAmount)}</p>
                          <p className="text-xs text-[var(--secondary)]">{formatDate(entry.expenseDate)}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setExpenseForm({
                              id: entry.id,
                              caseId: entry.caseId ?? '',
                              clientId: entry.clientId ?? '',
                              responsibleUserId: entry.responsibleUserId ?? '',
                              category: entry.category,
                              expenseDate: entry.expenseDate,
                              amount: String(entry.amount),
                              vatRate: String(entry.vatRate),
                              vatIncluded: entry.vatIncluded,
                              billableToClient: entry.billableToClient,
                              coveredByRetainer: entry.coveredByRetainer,
                              description: entry.description ?? '',
                              documentNo: entry.documentNo ?? '',
                              documentDate: entry.documentDate ?? '',
                              supplierName: entry.supplierName ?? '',
                              receiptPath: entry.receiptPath ?? '',
                            })
                          }
                        >
                          Duzenle
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void handleDeleteExpense(entry.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          Sil
                        </Button>
                        {entry.invoiceId ? <Badge variant="blue">Faturaya Eklendi</Badge> : <Badge variant="muted">Yansitilmadi</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div> : null}

      {activePanel === 'billing' ? <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3) Teklif + Sozlesme + Faturalama</CardTitle>
            <CardDescription>Teklif ve sozlesme kaydi olusturup faturaya baglayabilirsin.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3 rounded-xl border border-[var(--main-border,var(--border))] p-3">
              <p className="text-sm font-semibold text-[var(--text)]">Teklif Olustur</p>
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={proposalForm.caseId}
                  onChange={(event) => setProposalForm((prev) => ({ ...prev, caseId: event.target.value }))}
                  className={SELECT_CLASSNAME}
                >
                  <option value="">Dosya secin</option>
                  {(bootstrap?.cases ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <Input
                  type="date"
                  value={proposalForm.proposalDate}
                  onChange={(event) => setProposalForm((prev) => ({ ...prev, proposalDate: event.target.value }))}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={proposalForm.fixedFeeAmount}
                  onChange={(event) => setProposalForm((prev) => ({ ...prev, fixedFeeAmount: event.target.value }))}
                  placeholder="Sabit ucret"
                />
                <Input
                  value={proposalForm.hourlyRate}
                  onChange={(event) => setProposalForm((prev) => ({ ...prev, hourlyRate: event.target.value }))}
                  placeholder="Saatlik ucret"
                />
              </div>
              <Button onClick={() => void handleCreateProposal()} disabled={busy}>
                Teklif Ekle
              </Button>
            </div>

            <div className="space-y-3 rounded-xl border border-[var(--main-border,var(--border))] p-3">
              <p className="text-sm font-semibold text-[var(--text)]">Sozlesme Olustur</p>
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={contractForm.proposalId}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, proposalId: event.target.value }))}
                  className={SELECT_CLASSNAME}
                >
                  <option value="">Teklif secin (opsiyonel)</option>
                  {proposals.map((proposal) => (
                    <option key={proposal.id} value={proposal.id}>
                      {proposal.proposalNo}
                    </option>
                  ))}
                </select>
                <Input
                  type="date"
                  value={contractForm.signedAt}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, signedAt: event.target.value }))}
                />
              </div>
              <Input
                value={contractForm.monthlyRetainerAmount}
                onChange={(event) => setContractForm((prev) => ({ ...prev, monthlyRetainerAmount: event.target.value }))}
                placeholder="Aylik retainer tutari"
              />
              <Button onClick={() => void handleCreateContract()} disabled={busy}>
                Sozlesme Ekle
              </Button>
            </div>

            <div className="space-y-3 rounded-xl border border-[var(--main-border,var(--border))] p-3">
              <p className="text-sm font-semibold text-[var(--text)]">Fatura Olustur</p>
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={invoiceForm.caseId}
                  onChange={(event) => setInvoiceForm((prev) => ({ ...prev, caseId: event.target.value }))}
                  className={SELECT_CLASSNAME}
                >
                  <option value="">Dosya secin</option>
                  {(bootstrap?.cases ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <select
                  value={invoiceForm.clientId}
                  onChange={(event) => setInvoiceForm((prev) => ({ ...prev, clientId: event.target.value }))}
                  className={SELECT_CLASSNAME}
                >
                  <option value="">Muvekkil secin</option>
                  {(bootstrap?.clients ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <select
                  value={invoiceForm.proposalId}
                  onChange={(event) => setInvoiceForm((prev) => ({ ...prev, proposalId: event.target.value }))}
                  className={SELECT_CLASSNAME}
                >
                  <option value="">Teklif secin</option>
                  {proposals.map((proposal) => (
                    <option key={proposal.id} value={proposal.id}>
                      {proposal.proposalNo}
                    </option>
                  ))}
                </select>
                <select
                  value={invoiceForm.contractId}
                  onChange={(event) => setInvoiceForm((prev) => ({ ...prev, contractId: event.target.value }))}
                  className={SELECT_CLASSNAME}
                >
                  <option value="">Sozlesme secin</option>
                  {contracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.contractNo}
                    </option>
                  ))}
                </select>
                <Input
                  type="date"
                  value={invoiceForm.dueDate}
                  onChange={(event) => setInvoiceForm((prev) => ({ ...prev, dueDate: event.target.value }))}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Input
                  value={invoiceForm.vatRate}
                  onChange={(event) => setInvoiceForm((prev) => ({ ...prev, vatRate: event.target.value }))}
                  placeholder="KDV %"
                />
                <Input
                  value={invoiceForm.withholdingRate}
                  onChange={(event) => setInvoiceForm((prev) => ({ ...prev, withholdingRate: event.target.value }))}
                  placeholder="Stopaj %"
                />
                <Input
                  value={invoiceForm.discountTotal}
                  onChange={(event) => setInvoiceForm((prev) => ({ ...prev, discountTotal: event.target.value }))}
                  placeholder="Indirim"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={invoiceForm.manualAmount}
                  onChange={(event) => setInvoiceForm((prev) => ({ ...prev, manualAmount: event.target.value }))}
                  placeholder="Manuel kalem tutari"
                />
                <Input
                  value={invoiceForm.manualItemDescription}
                  onChange={(event) => setInvoiceForm((prev) => ({ ...prev, manualItemDescription: event.target.value }))}
                  placeholder="Manuel kalem aciklamasi"
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-xl border border-[var(--main-border,var(--border))] px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={invoiceForm.autoIncludeUnbilledTime}
                    onChange={(event) =>
                      setInvoiceForm((prev) => ({ ...prev, autoIncludeUnbilledTime: event.target.checked }))
                    }
                  />
                  Faturalanmamis sureleri ekle
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-[var(--main-border,var(--border))] px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={invoiceForm.autoIncludeUnbilledExpenses}
                    onChange={(event) =>
                      setInvoiceForm((prev) => ({ ...prev, autoIncludeUnbilledExpenses: event.target.checked }))
                    }
                  />
                  Yansitilabilir masraflari ekle
                </label>
              </div>
              <Textarea
                rows={2}
                value={invoiceForm.description}
                onChange={(event) => setInvoiceForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Fatura aciklamasi"
              />
              <Button onClick={() => void handleCreateInvoice()} disabled={busy}>
                Fatura Olustur
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">4) Tahsilat + Cari + Odeme Linki</CardTitle>
            <CardDescription>Kismi/tam tahsilat gir, gecikmeyi izle, online odeme linki uret.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3 rounded-xl border border-[var(--main-border,var(--border))] p-3">
              <p className="text-sm font-semibold text-[var(--text)]">Tahsilat Ekle</p>
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={paymentForm.invoiceId}
                  onChange={(event) => {
                    const invoiceId = event.target.value;
                    const invoice = invoices.find((row) => row.id === invoiceId);
                    setPaymentForm((prev) => ({
                      ...prev,
                      invoiceId,
                      caseId: invoice?.caseId ?? '',
                      clientId: invoice?.clientId ?? '',
                      amount: invoice ? String(invoice.amountDue) : prev.amount,
                    }));
                  }}
                  className={SELECT_CLASSNAME}
                >
                  <option value="">Fatura secin</option>
                  {invoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.invoiceNo} - {formatMoney(invoice.amountDue)}
                    </option>
                  ))}
                </select>
                <select
                  value={paymentForm.paymentMethod}
                  onChange={(event) =>
                    setPaymentForm((prev) => ({ ...prev, paymentMethod: event.target.value as FinancePaymentMethod }))
                  }
                  className={SELECT_CLASSNAME}
                >
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={paymentForm.amount}
                  onChange={(event) => setPaymentForm((prev) => ({ ...prev, amount: event.target.value }))}
                  placeholder="Tahsilat tutari"
                />
                <Input
                  type="date"
                  value={paymentForm.paymentDate}
                  onChange={(event) => setPaymentForm((prev) => ({ ...prev, paymentDate: event.target.value }))}
                />
              </div>
              <Input
                value={paymentForm.referenceNo}
                onChange={(event) => setPaymentForm((prev) => ({ ...prev, referenceNo: event.target.value }))}
                placeholder="Referans no"
              />
              <Textarea
                rows={2}
                value={paymentForm.note}
                onChange={(event) => setPaymentForm((prev) => ({ ...prev, note: event.target.value }))}
                placeholder="Tahsilat notu"
              />
              <Button onClick={() => void handleCreatePayment()} disabled={busy}>
                Tahsilat Kaydet
              </Button>
              {selectedInvoice ? (
                <p className="text-xs text-[var(--secondary)]">
                  Acik bakiye: {formatMoney(selectedInvoice.amountDue)} | Son odeme: {formatDate(selectedInvoice.dueDate)}
                </p>
              ) : null}
            </div>

            <div className="space-y-3 rounded-xl border border-[var(--main-border,var(--border))] p-3">
              <p className="text-sm font-semibold text-[var(--text)]">Odeme Linki Uret</p>
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={paymentLinkForm.invoiceId}
                  onChange={(event) => {
                    const invoiceId = event.target.value;
                    const invoice = invoices.find((row) => row.id === invoiceId);
                    setPaymentLinkForm((prev) => ({
                      ...prev,
                      invoiceId,
                      caseId: invoice?.caseId ?? '',
                      clientId: invoice?.clientId ?? '',
                      amount: invoice ? String(invoice.amountDue) : prev.amount,
                    }));
                  }}
                  className={SELECT_CLASSNAME}
                >
                  <option value="">Fatura secin</option>
                  {invoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.invoiceNo}
                    </option>
                  ))}
                </select>
                <Input
                  value={paymentLinkForm.provider}
                  onChange={(event) => setPaymentLinkForm((prev) => ({ ...prev, provider: event.target.value }))}
                  placeholder="Provider"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={paymentLinkForm.amount}
                  onChange={(event) => setPaymentLinkForm((prev) => ({ ...prev, amount: event.target.value }))}
                  placeholder="Link tutari"
                />
                <Input
                  type="date"
                  value={paymentLinkForm.expiresAt}
                  onChange={(event) => setPaymentLinkForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
                />
              </div>
              <Button onClick={() => void handleCreatePaymentLink()} disabled={busy}>
                <Link2 className="h-4 w-4" />
                Link Uret
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text)]">Fatura Durumlari</p>
              {invoices.length === 0 ? (
                <p className="text-sm text-[var(--secondary)]">Fatura kaydi yok.</p>
              ) : (
                invoices.slice(0, 7).map((invoice) => (
                  <div
                    key={invoice.id}
                    className={cn(
                      'rounded-xl border px-3 py-3',
                      invoice.status === 'overdue'
                        ? 'border-[color-mix(in_srgb,var(--warning),white_35%)] bg-[color-mix(in_srgb,var(--warning),white_92%)]'
                        : 'border-[var(--main-border,var(--border))]',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-[var(--text)]">{invoice.invoiceNo}</p>
                        <p className="text-xs text-[var(--secondary)]">
                          Vade: {formatDate(invoice.dueDate)} | Acik: {formatMoney(invoice.amountDue)}
                        </p>
                      </div>
                      <Badge variant={badgeForInvoiceStatus(invoice.status)}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => void handleRecordReminder(invoice.id)} disabled={busy}>
                        <BellRing className="h-3.5 w-3.5" />
                        Hatirlatma
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text)]">Tahsilat Kayitlari</p>
              {payments.length === 0 ? (
                <p className="text-sm text-[var(--secondary)]">Tahsilat kaydi yok.</p>
              ) : (
                payments.slice(0, 7).map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-[var(--text)]">{payment.paymentNo}</p>
                      <p className="text-xs text-[var(--secondary)]">
                        {PAYMENT_METHOD_LABELS[payment.paymentMethod]} - {formatDate(payment.paymentDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--text)]">{formatMoney(payment.amount)}</p>
                      <Button size="sm" variant="outline" onClick={() => void handleDeletePayment(payment.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text)]">Odeme Linkleri</p>
              {paymentLinks.length === 0 ? (
                <p className="text-sm text-[var(--secondary)]">Odeme linki yok.</p>
              ) : (
                paymentLinks.slice(0, 6).map((link) => (
                  <div key={link.id} className="rounded-lg border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-[var(--text)]">{link.linkCode}</p>
                        <p className="text-xs text-[var(--secondary)]">{formatMoney(link.amount)}</p>
                      </div>
                      <Badge variant={badgeForPaymentLinkStatus(link.status)}>{PAYMENT_LINK_STATUS_LABELS[link.status]}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value={link.status}
                        onChange={(event) =>
                          void handleUpdatePaymentLinkStatus(link.id, event.target.value as FinancePaymentLinkStatus)
                        }
                        className={cn(SELECT_CLASSNAME, 'max-w-[190px]')}
                      >
                        {Object.entries(PAYMENT_LINK_STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      {link.url ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(link.url ?? '');
                              notify('Odeme linki kopyalandi.');
                            } catch {
                              notify('Link kopyalanamadi.', 'error');
                            }
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          URL Kopyala
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div> : null}

      {activePanel === 'retainers' ? <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">5) Avans (Retainer) Yonetimi</CardTitle>
            <CardDescription>Hizmet/masraf avansi al, mahsup et, kalan avansi takip et.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3 rounded-xl border border-[var(--main-border,var(--border))] p-3">
              <p className="text-sm font-semibold text-[var(--text)]">Avans Al</p>
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={retainerForm.caseId}
                  onChange={(event) => setRetainerForm((prev) => ({ ...prev, caseId: event.target.value }))}
                  className={SELECT_CLASSNAME}
                >
                  <option value="">Dosya secin</option>
                  {(bootstrap?.cases ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
                <select
                  value={retainerForm.retainerType}
                  onChange={(event) => setRetainerForm((prev) => ({ ...prev, retainerType: event.target.value as FinanceRetainerType }))}
                  className={SELECT_CLASSNAME}
                >
                  <option value="service">Hizmet Avansi</option>
                  <option value="expense">Masraf Avansi</option>
                </select>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={retainerForm.amount}
                  onChange={(event) => setRetainerForm((prev) => ({ ...prev, amount: event.target.value }))}
                  placeholder="Avans tutari"
                />
                <Input
                  type="date"
                  value={retainerForm.receivedDate}
                  onChange={(event) => setRetainerForm((prev) => ({ ...prev, receivedDate: event.target.value }))}
                />
              </div>
              <Textarea
                rows={2}
                value={retainerForm.note}
                onChange={(event) => setRetainerForm((prev) => ({ ...prev, note: event.target.value }))}
                placeholder="Avans notu"
              />
              <Button onClick={() => void handleCreateRetainer()} disabled={busy}>
                <HandCoins className="h-4 w-4" />
                Avans Kaydet
              </Button>
            </div>

            <div className="space-y-3 rounded-xl border border-[var(--main-border,var(--border))] p-3">
              <p className="text-sm font-semibold text-[var(--text)]">Avans Mahsup Et</p>
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={retainerAllocationForm.retainerId}
                  onChange={(event) => setRetainerAllocationForm((prev) => ({ ...prev, retainerId: event.target.value }))}
                  className={SELECT_CLASSNAME}
                >
                  <option value="">Avans secin</option>
                  {retainers.map((retainer) => (
                    <option key={retainer.id} value={retainer.id}>
                      {retainer.retainerNo} - Kalan {formatMoney(retainer.remainingAmount)}
                    </option>
                  ))}
                </select>
                <Input
                  value={retainerAllocationForm.amount}
                  onChange={(event) => setRetainerAllocationForm((prev) => ({ ...prev, amount: event.target.value }))}
                  placeholder="Mahsup tutari"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={retainerAllocationForm.invoiceId}
                  onChange={(event) => setRetainerAllocationForm((prev) => ({ ...prev, invoiceId: event.target.value }))}
                  className={SELECT_CLASSNAME}
                >
                  <option value="">Fatura (opsiyonel)</option>
                  {invoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.invoiceNo}
                    </option>
                  ))}
                </select>
                <select
                  value={retainerAllocationForm.expenseId}
                  onChange={(event) => setRetainerAllocationForm((prev) => ({ ...prev, expenseId: event.target.value }))}
                  className={SELECT_CLASSNAME}
                >
                  <option value="">Masraf (opsiyonel)</option>
                  {expenses.map((expense) => (
                    <option key={expense.id} value={expense.id}>
                      {EXPENSE_CATEGORY_LABELS[expense.category]} - {formatMoney(expense.grossAmount)}
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={() => void handleAllocateRetainer()} disabled={busy}>
                Mahsup Kaydet
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text)]">Aktif Avanslar</p>
              {retainers.length === 0 ? (
                <p className="text-sm text-[var(--secondary)]">Avans kaydi yok.</p>
              ) : (
                retainers.slice(0, 7).map((retainer) => (
                  <div key={retainer.id} className="rounded-lg border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-[var(--text)]">{retainer.retainerNo}</p>
                        <p className="text-xs text-[var(--secondary)]">{formatDate(retainer.receivedDate)}</p>
                      </div>
                      <Badge variant={retainer.status === 'exhausted' ? 'warning' : 'success'}>{retainer.status}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-[var(--secondary)]">
                      Toplam: {formatMoney(retainer.amount)} | Kullanilan: {formatMoney(retainer.usedAmount)} | Kalan:{' '}
                      {formatMoney(retainer.remainingAmount)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">6) Vergi + Karlilik + Risk</CardTitle>
            <CardDescription>KDV, stopaj, gelir vergisi karsiligi ve net kar gorunumu.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Input
                value={taxConfigForm.vatRate}
                onChange={(event) => setTaxConfigForm((prev) => ({ ...prev, vatRate: event.target.value }))}
                placeholder="KDV %"
              />
              <Input
                value={taxConfigForm.withholdingRate}
                onChange={(event) => setTaxConfigForm((prev) => ({ ...prev, withholdingRate: event.target.value }))}
                placeholder="Stopaj %"
              />
              <Input
                value={taxConfigForm.estimatedIncomeTaxRate}
                onChange={(event) => setTaxConfigForm((prev) => ({ ...prev, estimatedIncomeTaxRate: event.target.value }))}
                placeholder="Gelir vergisi %"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={taxConfigForm.minBillingMinutes}
                onChange={(event) => setTaxConfigForm((prev) => ({ ...prev, minBillingMinutes: event.target.value }))}
                placeholder="Min fatura dakika"
              />
              <Input
                value={taxConfigForm.billingRoundingMinutes}
                onChange={(event) =>
                  setTaxConfigForm((prev) => ({ ...prev, billingRoundingMinutes: event.target.value }))
                }
                placeholder="Yuvarlama dakika"
              />
            </div>
            <Button onClick={() => void handleSaveTaxConfig()} disabled={busy}>
              <Scale className="h-4 w-4" />
              Vergi Ayarlarini Kaydet
            </Button>

            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard
                label="Net KDV Pozisyonu"
                value={formatMoney(overview?.tax.netVatPosition ?? 0)}
                detail={`Cikacak KDV ${formatMoney(overview?.tax.outputVat ?? 0)}`}
                icon={Scale}
                tone="orange"
              />
              <MetricCard
                label="Vergi Sonrasi Net Kar"
                value={formatMoney(overview?.tax.netProfitAfterTax ?? 0)}
                detail={`Tahmini gelir vergisi ${formatMoney(overview?.tax.estimatedIncomeTax ?? 0)}`}
                icon={PieChart}
                tone="blue"
              />
            </div>

            <div className="space-y-3 rounded-xl border border-[var(--main-border,var(--border))] p-3">
              <p className="text-sm font-semibold text-[var(--text)]">Donemsel Vergi Ozeti Uret</p>
              <div className="grid gap-3 md:grid-cols-3">
                <select
                  value={taxSummaryForm.periodType}
                  onChange={(event) =>
                    setTaxSummaryForm((prev) => ({ ...prev, periodType: event.target.value as FinanceTaxSummary['periodType'] }))
                  }
                  className={SELECT_CLASSNAME}
                >
                  <option value="monthly">Aylik</option>
                  <option value="quarterly">Ceyreklik</option>
                  <option value="yearly">Yillik</option>
                </select>
                <Input
                  type="date"
                  value={taxSummaryForm.periodStart}
                  onChange={(event) => setTaxSummaryForm((prev) => ({ ...prev, periodStart: event.target.value }))}
                />
                <Input
                  type="date"
                  value={taxSummaryForm.periodEnd}
                  onChange={(event) => setTaxSummaryForm((prev) => ({ ...prev, periodEnd: event.target.value }))}
                />
              </div>
              <Button onClick={() => void handleCreateTaxSummary()} disabled={busy}>
                Vergi Ozeti Uret
              </Button>
            </div>
          </CardContent>
        </Card>
      </div> : null}

      {activePanel === 'insights' ? <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dosya Bazli Karlilik</CardTitle>
            <CardDescription>Gelir, dogrudan gider, emek maliyeti ve net kar.</CardDescription>
          </CardHeader>
          <CardContent>
            {overview?.profitabilityByCase.length ? (
              <div className="overflow-x-auto rounded-xl border border-[var(--main-border,var(--border))]">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b bg-[var(--main-surface-2,var(--surface))] text-left">
                      <th className="px-3 py-2">Dosya</th>
                      <th className="px-3 py-2">Gelir</th>
                      <th className="px-3 py-2">Gider</th>
                      <th className="px-3 py-2">Emek Maliyeti</th>
                      <th className="px-3 py-2">Net Kar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.profitabilityByCase.map((row) => (
                      <tr key={row.caseId} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium">{row.caseTitle}</td>
                        <td className="px-3 py-2">{formatMoney(row.revenue)}</td>
                        <td className="px-3 py-2">{formatMoney(row.directExpense)}</td>
                        <td className="px-3 py-2">{formatMoney(row.laborCost)}</td>
                        <td className={cn('px-3 py-2 font-semibold', row.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                          {formatMoney(row.netProfit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--secondary)]">Karlilik verisi yok.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Riskli Alacaklar + Vergi Snapshot</CardTitle>
            <CardDescription>Geciken tahsilatlar ve olusmus vergi ozet snapshotlari.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text)]">Gecikmis Alacaklar</p>
              {overview?.riskyReceivables.length ? (
                overview.riskyReceivables.map((row) => (
                  <div key={row.invoiceId} className="rounded-lg border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-[var(--text)]">{row.invoiceNo}</p>
                      <Badge variant="critical">{row.delayDays} gun gecikme</Badge>
                    </div>
                    <p className="text-xs text-[var(--secondary)]">
                      {row.clientName ?? 'Muvekkil yok'} - Acik bakiye {formatMoney(row.amountDue)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[var(--secondary)]">Gecikmis alacak yok.</p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text)]">Vergi Ozetleri</p>
              {taxSummaries.length ? (
                taxSummaries.slice(0, 6).map((summary) => (
                  <div key={summary.id} className="rounded-lg border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-[var(--text)]">
                        {summary.periodType} {formatDate(summary.periodStart)} - {formatDate(summary.periodEnd)}
                      </p>
                      <Badge variant="outline">{formatMoney(summary.netProfitAfterTax)}</Badge>
                    </div>
                    <p className="text-xs text-[var(--secondary)]">
                      Net KDV: {formatMoney(summary.netVatPosition)} | Gelir Vergisi: {formatMoney(summary.estimatedIncomeTax)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[var(--secondary)]">Vergi ozeti henuz uretilmedi.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operasyon Ozeti</CardTitle>
          <CardDescription>Toplam sure, masraf, fatura ve tahsilat.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border px-3 py-2">
            <p className="text-xs text-[var(--secondary)]">Toplam Sure</p>
            <p className="text-sm font-semibold text-[var(--text)]">{formatDuration(totalTrackedMinutes)}</p>
          </div>
          <div className="rounded-xl border px-3 py-2">
            <p className="text-xs text-[var(--secondary)]">Toplam Masraf</p>
            <p className="text-sm font-semibold text-[var(--text)]">{formatMoney(totalExpense)}</p>
          </div>
          <div className="rounded-xl border px-3 py-2">
            <p className="text-xs text-[var(--secondary)]">Toplam Fatura</p>
            <p className="text-sm font-semibold text-[var(--text)]">{formatMoney(totalInvoiced)}</p>
          </div>
          <div className="rounded-xl border px-3 py-2">
            <p className="text-xs text-[var(--secondary)]">Bekleyen Tahsilat</p>
            <p className="text-sm font-semibold text-[var(--text)]">{formatMoney(pendingCollection)}</p>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
