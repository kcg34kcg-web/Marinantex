'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlarmClockPlus,
  BellRing,
  CircleDollarSign,
  Clock3,
  Link2,
  Pause,
  Play,
  ReceiptText,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type TimeSource = 'manual' | 'timer';
type BillingModel = 'hourly' | 'fixed' | 'success_fee';
type ExpenseCategory = 'harc' | 'tebligat' | 'bilirkisi' | 'yol' | 'diger';
type PaymentProvider = 'iyzico' | 'paytr' | 'stripe';

interface TimeEntry {
  id: string;
  matter: string;
  note: string;
  minutes: number;
  source: TimeSource;
  createdAt: string;
}

interface ExpenseEntry {
  id: string;
  matter: string;
  category: ExpenseCategory;
  note: string;
  amount: number;
  createdAt: string;
}

interface InvoiceEntry {
  id: string;
  matter: string;
  model: BillingModel;
  amount: number;
  offerRef: string;
  contractRef: string;
  dueDate: string;
  paid: boolean;
  remindedAt: string | null;
  createdAt: string;
}

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'blue' | 'orange' | 'muted';
}

const CURRENCY = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  maximumFractionDigits: 2,
});

const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  harc: 'Harc',
  tebligat: 'Tebligat',
  bilirkisi: 'Bilirkisi',
  yol: 'Yol',
  diger: 'Diger',
};

const BILLING_MODEL_LABELS: Record<BillingModel, string> = {
  hourly: 'Saatlik',
  fixed: 'Sabit',
  success_fee: 'Basari primi',
};

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  iyzico: 'iyzico',
  paytr: 'PayTR',
  stripe: 'Stripe',
};

const SELECT_CLASSNAME =
  'w-full min-h-[44px] rounded-xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] px-3 text-sm text-[var(--main-text,var(--text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring,var(--primary))] focus-visible:ring-offset-2';

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseAmount(value: string): number {
  const normalized = value.replace(',', '.').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeMatter(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : 'Genel';
}

function formatMoney(amount: number): string {
  return CURRENCY.format(Number.isFinite(amount) ? amount : 0);
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const restMinutes = Math.round(minutes % 60);
  if (hours === 0) return `${restMinutes} dk`;
  return `${hours} sa ${restMinutes} dk`;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString('tr-TR');
}

function formatStopwatch(totalSeconds: number): string {
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

function futureDate(days: number): string {
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function isOverdue(invoice: InvoiceEntry): boolean {
  if (invoice.paid) return false;
  const dueAt = new Date(`${invoice.dueDate}T23:59:59`);
  return !Number.isNaN(dueAt.getTime()) && dueAt.getTime() < Date.now();
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
  const [notice, setNotice] = useState<string | null>(null);

  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [manualMatter, setManualMatter] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [manualMinutes, setManualMinutes] = useState('30');

  const [timerMatter, setTimerMatter] = useState('');
  const [timerNote, setTimerNote] = useState('');
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);

  const [expenseEntries, setExpenseEntries] = useState<ExpenseEntry[]>([]);
  const [expenseMatter, setExpenseMatter] = useState('');
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory>('harc');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNote, setExpenseNote] = useState('');

  const [invoiceEntries, setInvoiceEntries] = useState<InvoiceEntry[]>([]);
  const [invoiceMatter, setInvoiceMatter] = useState('');
  const [invoiceModel, setInvoiceModel] = useState<BillingModel>('hourly');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceOfferRef, setInvoiceOfferRef] = useState('');
  const [invoiceContractRef, setInvoiceContractRef] = useState('');
  const [invoiceDueDate, setInvoiceDueDate] = useState(futureDate(14));

  const [internalHourCost, setInternalHourCost] = useState('950');
  const [paymentProvider, setPaymentProvider] = useState<PaymentProvider>('iyzico');
  const [paymentInvoiceId, setPaymentInvoiceId] = useState('');
  const [paymentLink, setPaymentLink] = useState('');

  useEffect(() => {
    if (!timerRunning) return;
    const intervalId = window.setInterval(() => {
      setTimerSeconds((previous) => previous + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [timerRunning]);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const totalTrackedMinutes = useMemo(
    () => timeEntries.reduce((sum, entry) => sum + entry.minutes, 0),
    [timeEntries],
  );
  const totalExpenses = useMemo(
    () => expenseEntries.reduce((sum, entry) => sum + entry.amount, 0),
    [expenseEntries],
  );
  const totalInvoiced = useMemo(
    () => invoiceEntries.reduce((sum, entry) => sum + entry.amount, 0),
    [invoiceEntries],
  );
  const totalCollected = useMemo(
    () =>
      invoiceEntries.reduce((sum, entry) => {
        if (!entry.paid) return sum;
        return sum + entry.amount;
      }, 0),
    [invoiceEntries],
  );

  const overdueCount = useMemo(
    () => invoiceEntries.filter((entry) => isOverdue(entry)).length,
    [invoiceEntries],
  );

  const profitabilityRows = useMemo(() => {
    const matters = new Set<string>();
    timeEntries.forEach((entry) => matters.add(normalizeMatter(entry.matter)));
    expenseEntries.forEach((entry) => matters.add(normalizeMatter(entry.matter)));
    invoiceEntries.forEach((entry) => matters.add(normalizeMatter(entry.matter)));

    const hourCost = parseAmount(internalHourCost);
    const normalizedHourCost = Number.isFinite(hourCost) && hourCost >= 0 ? hourCost : 0;

    return [...matters]
      .map((matter) => {
        const revenue = invoiceEntries
          .filter((entry) => normalizeMatter(entry.matter) === matter)
          .reduce((sum, entry) => sum + entry.amount, 0);

        const expenses = expenseEntries
          .filter((entry) => normalizeMatter(entry.matter) === matter)
          .reduce((sum, entry) => sum + entry.amount, 0);

        const laborMinutes = timeEntries
          .filter((entry) => normalizeMatter(entry.matter) === matter)
          .reduce((sum, entry) => sum + entry.minutes, 0);

        const laborCost = (laborMinutes / 60) * normalizedHourCost;
        const totalCost = expenses + laborCost;

        return {
          matter,
          revenue,
          expenses,
          laborCost,
          profit: revenue - totalCost,
        };
      })
      .sort((left, right) => right.profit - left.profit);
  }, [expenseEntries, internalHourCost, invoiceEntries, timeEntries]);

  function addManualTimeEntry() {
    const minutes = parseAmount(manualMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setNotice('Gecerli dakika degeri girin.');
      return;
    }

    setTimeEntries((previous) => [
      {
        id: createId(),
        matter: normalizeMatter(manualMatter),
        note: manualNote.trim() || 'Manuel kayit',
        minutes,
        source: 'manual',
        createdAt: new Date().toISOString(),
      },
      ...previous,
    ]);

    setManualMinutes('30');
    setManualNote('');
    setNotice('Manuel zaman kaydi eklendi.');
  }

  function saveTimerEntry() {
    if (timerSeconds <= 0) {
      setNotice('Kronometre sifir. Once sure olusturun.');
      return;
    }

    const minutes = Number((timerSeconds / 60).toFixed(2));
    setTimeEntries((previous) => [
      {
        id: createId(),
        matter: normalizeMatter(timerMatter),
        note: timerNote.trim() || 'Kronometre kaydi',
        minutes,
        source: 'timer',
        createdAt: new Date().toISOString(),
      },
      ...previous,
    ]);

    setTimerRunning(false);
    setTimerSeconds(0);
    setTimerNote('');
    setNotice('Kronometre kaydi eklendi.');
  }

  function addExpenseEntry() {
    const amount = parseAmount(expenseAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice('Masraf tutari gecersiz.');
      return;
    }

    setExpenseEntries((previous) => [
      {
        id: createId(),
        matter: normalizeMatter(expenseMatter),
        category: expenseCategory,
        note: expenseNote.trim() || 'Masraf kaydi',
        amount,
        createdAt: new Date().toISOString(),
      },
      ...previous,
    ]);

    setExpenseAmount('');
    setExpenseNote('');
    setNotice('Masraf kaydi eklendi.');
  }

  function addInvoiceEntry() {
    const amount = parseAmount(invoiceAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice('Fatura tutari gecersiz.');
      return;
    }

    setInvoiceEntries((previous) => [
      {
        id: createId(),
        matter: normalizeMatter(invoiceMatter),
        model: invoiceModel,
        amount,
        offerRef: invoiceOfferRef.trim(),
        contractRef: invoiceContractRef.trim(),
        dueDate: invoiceDueDate,
        paid: false,
        remindedAt: null,
        createdAt: new Date().toISOString(),
      },
      ...previous,
    ]);

    setInvoiceAmount('');
    setInvoiceOfferRef('');
    setInvoiceContractRef('');
    setNotice('Fatura ve sozlesme kaydi olusturuldu.');
  }

  function togglePaid(invoiceId: string) {
    setInvoiceEntries((previous) =>
      previous.map((entry) => {
        if (entry.id !== invoiceId) return entry;
        return { ...entry, paid: !entry.paid };
      }),
    );
  }

  function sendReminder(invoiceId: string) {
    setInvoiceEntries((previous) =>
      previous.map((entry) => {
        if (entry.id !== invoiceId) return entry;
        if (entry.paid) return entry;
        return { ...entry, remindedAt: new Date().toISOString() };
      }),
    );
    setNotice('Hatirlatma kaydi olusturuldu.');
  }

  function generatePaymentLink() {
    const chosen =
      invoiceEntries.find((entry) => entry.id === paymentInvoiceId) ??
      invoiceEntries.find((entry) => !entry.paid) ??
      null;

    if (!chosen) {
      setNotice('Odeme linki icin once fatura kaydi olusturun.');
      return;
    }

    const token = Math.random().toString(36).slice(2, 10);
    const url = `https://odeme.marinatex.local/${paymentProvider}/${chosen.id.slice(-8)}?token=${token}`;
    setPaymentLink(url);
    setNotice('Demo odeme linki olusturuldu.');
  }

  async function copyPaymentLink() {
    if (!paymentLink) return;
    try {
      await navigator.clipboard.writeText(paymentLink);
      setNotice('Odeme linki panoya kopyalandi.');
    } catch {
      setNotice('Kopyalama izni yok. Linki manuel kopyalayin.');
    }
  }

  return (
    <section className="space-y-6">
      <Card glass className="overflow-hidden">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="blue">Olmazsa olmaz</Badge>
            <Badge variant="orange">Ileri seviye</Badge>
          </div>
          <CardTitle className="text-2xl">Zaman Takibi, Ucretlendirme, Tahsilat</CardTitle>
          <CardDescription>
            Sure kaydi, masraf, faturalama ve tahsilat akislarini tek sayfada yonet. Dosya bazli karlilik ve online odeme
            linki icin ileri seviye kutular da hazir.
          </CardDescription>
          {notice ? (
            <p className="rounded-xl border border-[color-mix(in_srgb,var(--primary),white_70%)] bg-[color-mix(in_srgb,var(--primary),white_92%)] px-3 py-2 text-sm text-[var(--primary)]">
              {notice}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-semibold text-[var(--text)]">Olmazsa olmaz</p>
            <ul className="space-y-1 text-sm text-[var(--secondary)]">
              <li>Time tracking (manuel + kronometre)</li>
              <li>Masraf takibi (harc, tebligat, bilirkisi, yol vb.)</li>
              <li>Faturalama (saatlik/sabit/basari primi) + teklif/sozlesme kayitlari</li>
              <li>Tahsilat ve cari: odemeler, gecikme, hatirlatma</li>
            </ul>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-[var(--text)]">Ileri seviye</p>
            <ul className="space-y-1 text-sm text-[var(--secondary)]">
              <li>Gelir-gider raporlari ve dosya bazli karlilik</li>
              <li>Online odeme linki entegrasyonu (demo)</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-4">
        <MetricCard
          label="Toplam Sure"
          value={formatDuration(totalTrackedMinutes)}
          detail={`${timeEntries.length} kayit`}
          icon={Clock3}
          tone="blue"
        />
        <MetricCard
          label="Toplam Masraf"
          value={formatMoney(totalExpenses)}
          detail={`${expenseEntries.length} hareket`}
          icon={ReceiptText}
          tone="orange"
        />
        <MetricCard
          label="Faturalanan"
          value={formatMoney(totalInvoiced)}
          detail={`${invoiceEntries.length} fatura`}
          icon={CircleDollarSign}
          tone="blue"
        />
        <MetricCard
          label="Bekleyen Tahsilat"
          value={formatMoney(totalInvoiced - totalCollected)}
          detail={`${overdueCount} gecikmis`}
          icon={Wallet}
          tone="muted"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1) Time Tracking</CardTitle>
            <CardDescription>Manuel giris + kronometre ile calisma suresi kayitlari.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={manualMatter}
                onChange={(event) => setManualMatter(event.target.value)}
                placeholder="Dosya / musteri (or. 2026/115)"
              />
              <Input
                value={manualMinutes}
                onChange={(event) => setManualMinutes(event.target.value)}
                placeholder="Dakika (or. 45)"
              />
            </div>
            <Textarea
              value={manualNote}
              onChange={(event) => setManualNote(event.target.value)}
              placeholder="Manuel calisma notu"
              rows={2}
            />
            <Button onClick={addManualTimeEntry} className="w-full sm:w-auto whitespace-nowrap">
              <AlarmClockPlus className="h-4 w-4" />
              Manuel sure ekle
            </Button>

            <div className="rounded-xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] p-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={timerMatter}
                  onChange={(event) => setTimerMatter(event.target.value)}
                  placeholder="Kronometre dosyasi"
                />
                <Input
                  value={timerNote}
                  onChange={(event) => setTimerNote(event.target.value)}
                  placeholder="Kronometre notu"
                />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <p className="min-w-[112px] rounded-xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-3,var(--surface))] px-3 py-2 text-center font-mono text-lg font-semibold text-[var(--text)]">
                  {formatStopwatch(timerSeconds)}
                </p>
                {!timerRunning ? (
                  <Button onClick={() => setTimerRunning(true)} variant="outline" className="w-full whitespace-nowrap">
                    <Play className="h-4 w-4" />
                    Baslat
                  </Button>
                ) : (
                  <Button onClick={() => setTimerRunning(false)} variant="outline" className="w-full whitespace-nowrap">
                    <Pause className="h-4 w-4" />
                    Durdur
                  </Button>
                )}
                <Button onClick={saveTimerEntry} className="w-full whitespace-nowrap">
                  Kaydi olustur
                </Button>
                <Button
                  onClick={() => {
                    setTimerRunning(false);
                    setTimerSeconds(0);
                  }}
                  variant="ghost"
                  className="w-full whitespace-nowrap"
                >
                  Sifirla
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text)]">Son sure kayitlari</p>
              {timeEntries.length === 0 ? (
                <p className="text-sm text-[var(--secondary)]">Henuz sure kaydi yok.</p>
              ) : (
                <ul className="space-y-2">
                  {timeEntries.slice(0, 5).map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--main-border,var(--border))] px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium text-[var(--text)]">{normalizeMatter(entry.matter)}</p>
                        <p className="text-xs text-[var(--secondary)]">{entry.note}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-[var(--text)]">{formatDuration(entry.minutes)}</p>
                        <p className="text-xs text-[var(--secondary)]">
                          {entry.source === 'manual' ? 'Manuel' : 'Kronometre'} - {formatDate(entry.createdAt)}
                        </p>
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
            <CardDescription>Harc, tebligat, bilirkisi, yol ve diger giderleri kaydet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={expenseMatter}
                onChange={(event) => setExpenseMatter(event.target.value)}
                placeholder="Dosya / musteri"
              />
              <select
                value={expenseCategory}
                onChange={(event) => setExpenseCategory(event.target.value as ExpenseCategory)}
                className={SELECT_CLASSNAME}
              >
                <option value="harc">Harc</option>
                <option value="tebligat">Tebligat</option>
                <option value="bilirkisi">Bilirkisi</option>
                <option value="yol">Yol</option>
                <option value="diger">Diger</option>
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={expenseAmount}
                onChange={(event) => setExpenseAmount(event.target.value)}
                placeholder="Tutar (TRY)"
              />
              <Input
                value={expenseNote}
                onChange={(event) => setExpenseNote(event.target.value)}
                placeholder="Aciklama"
              />
            </div>
            <Button onClick={addExpenseEntry} className="w-full sm:w-auto whitespace-nowrap">
              Masraf ekle
            </Button>

            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text)]">Son masraflar</p>
              {expenseEntries.length === 0 ? (
                <p className="text-sm text-[var(--secondary)]">Masraf kaydi yok.</p>
              ) : (
                <ul className="space-y-2">
                  {expenseEntries.slice(0, 6).map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--main-border,var(--border))] px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium text-[var(--text)]">{normalizeMatter(entry.matter)}</p>
                        <p className="text-xs text-[var(--secondary)]">
                          {EXPENSE_LABELS[entry.category]} - {entry.note}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-[var(--text)]">{formatMoney(entry.amount)}</p>
                        <p className="text-xs text-[var(--secondary)]">{formatDate(entry.createdAt)}</p>
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
            <CardTitle className="text-base">3) Faturalama + Teklif / Sozlesme</CardTitle>
            <CardDescription>Saatlik, sabit veya basari primi modelinde fatura olustur.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={invoiceMatter}
                onChange={(event) => setInvoiceMatter(event.target.value)}
                placeholder="Dosya / musteri"
              />
              <select
                value={invoiceModel}
                onChange={(event) => setInvoiceModel(event.target.value as BillingModel)}
                className={SELECT_CLASSNAME}
              >
                <option value="hourly">Saatlik</option>
                <option value="fixed">Sabit</option>
                <option value="success_fee">Basari primi</option>
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={invoiceAmount}
                onChange={(event) => setInvoiceAmount(event.target.value)}
                placeholder="Fatura tutari (TRY)"
              />
              <Input
                type="date"
                value={invoiceDueDate}
                onChange={(event) => setInvoiceDueDate(event.target.value)}
                placeholder="Vade tarihi"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={invoiceOfferRef}
                onChange={(event) => setInvoiceOfferRef(event.target.value)}
                placeholder="Teklif no / ref"
              />
              <Input
                value={invoiceContractRef}
                onChange={(event) => setInvoiceContractRef(event.target.value)}
                placeholder="Sozlesme no / ref"
              />
            </div>
            <Button onClick={addInvoiceEntry} className="w-full sm:w-auto whitespace-nowrap">
              Fatura kaydi olustur
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">4) Tahsilat ve Cari</CardTitle>
            <CardDescription>Odeme durumu, gecikme tespiti ve hatirlatma aksiyonlari.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {invoiceEntries.length === 0 ? (
              <p className="text-sm text-[var(--secondary)]">Tahsilat listesi icin once fatura olusturun.</p>
            ) : (
              invoiceEntries.slice(0, 8).map((invoice) => (
                <div
                  key={invoice.id}
                  className={cn(
                    'rounded-xl border px-3 py-3',
                    isOverdue(invoice)
                      ? 'border-[color-mix(in_srgb,var(--warning),white_40%)] bg-[color-mix(in_srgb,var(--warning),white_92%)]'
                      : 'border-[var(--main-border,var(--border))]',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-[var(--text)]">{normalizeMatter(invoice.matter)}</p>
                      <p className="text-xs text-[var(--secondary)]">
                        {BILLING_MODEL_LABELS[invoice.model]} - Vade: {formatDate(invoice.dueDate)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-[var(--text)]">{formatMoney(invoice.amount)}</p>
                      <Badge variant={invoice.paid ? 'success' : isOverdue(invoice) ? 'warning' : 'muted'}>
                        {invoice.paid ? 'Odendi' : isOverdue(invoice) ? 'Gecikmis' : 'Bekliyor'}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <Button
                      size="sm"
                      variant={invoice.paid ? 'outline' : 'default'}
                      onClick={() => togglePaid(invoice.id)}
                      className="w-full whitespace-nowrap justify-center"
                    >
                      {invoice.paid ? 'Odemeyi geri al' : 'Odendi olarak isaretle'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => sendReminder(invoice.id)}
                      disabled={invoice.paid}
                      className="w-full whitespace-nowrap justify-center"
                    >
                      <BellRing className="h-3.5 w-3.5" />
                      Hatirlatma
                    </Button>
                  </div>

                  {invoice.remindedAt ? (
                    <p className="mt-2 text-xs text-[var(--secondary)]">Son hatirlatma: {formatDate(invoice.remindedAt)}</p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ileri Seviye: Gelir-Gider ve Karlilik</CardTitle>
            <CardDescription>Dosya bazli gelir, operasyon maliyeti ve net kar analizi.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                value={internalHourCost}
                onChange={(event) => setInternalHourCost(event.target.value)}
                placeholder="Saatlik ic maliyet (TRY)"
                className="max-w-[220px]"
              />
              <p className="text-xs text-[var(--secondary)]">
                Sure kayitlari bu degerle maliyetlendirilir (dk / 60 x saatlik maliyet).
              </p>
            </div>

            {profitabilityRows.length === 0 ? (
              <p className="text-sm text-[var(--secondary)]">Rapor icin en az bir sure/masraf/fatura kaydi gerekiyor.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[var(--main-border,var(--border))]">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] text-left">
                      <th className="px-3 py-2 font-medium text-[var(--secondary)]">Dosya</th>
                      <th className="px-3 py-2 font-medium text-[var(--secondary)]">Gelir</th>
                      <th className="px-3 py-2 font-medium text-[var(--secondary)]">Gider</th>
                      <th className="px-3 py-2 font-medium text-[var(--secondary)]">Emek Maliyeti</th>
                      <th className="px-3 py-2 font-medium text-[var(--secondary)]">Net Kar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitabilityRows.map((row) => (
                      <tr key={row.matter} className="border-b border-[var(--main-border,var(--border))] last:border-0">
                        <td className="px-3 py-2 font-medium text-[var(--text)]">{row.matter}</td>
                        <td className="px-3 py-2 text-[var(--text)]">{formatMoney(row.revenue)}</td>
                        <td className="px-3 py-2 text-[var(--text)]">{formatMoney(row.expenses)}</td>
                        <td className="px-3 py-2 text-[var(--text)]">{formatMoney(row.laborCost)}</td>
                        <td className={cn('px-3 py-2 font-semibold', row.profit >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                          {formatMoney(row.profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ileri Seviye: Online Odeme Linki</CardTitle>
            <CardDescription>iyzico / PayTR / Stripe baglantisi icin entegrasyon hazirlik paneli.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <select
                value={paymentProvider}
                onChange={(event) => setPaymentProvider(event.target.value as PaymentProvider)}
                className={SELECT_CLASSNAME}
              >
                <option value="iyzico">{PROVIDER_LABELS.iyzico}</option>
                <option value="paytr">{PROVIDER_LABELS.paytr}</option>
                <option value="stripe">{PROVIDER_LABELS.stripe}</option>
              </select>

              <select
                value={paymentInvoiceId}
                onChange={(event) => setPaymentInvoiceId(event.target.value)}
                className={SELECT_CLASSNAME}
              >
                <option value="">Fatura secin (opsiyonel)</option>
                {invoiceEntries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {normalizeMatter(entry.matter)} - {formatMoney(entry.amount)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button onClick={generatePaymentLink} className="w-full whitespace-nowrap justify-center">
                <Link2 className="h-4 w-4" />
                Demo link olustur
              </Button>
              <Button
                onClick={copyPaymentLink}
                variant="outline"
                disabled={!paymentLink}
                className="w-full whitespace-nowrap justify-center"
              >
                Linki kopyala
              </Button>
            </div>

            <Input value={paymentLink} readOnly placeholder="Olusan odeme linki burada gorunur" />
            <p className="text-xs text-[var(--secondary)]">
              Not: Bu sayfa demo link olusturur. Canli odeme icin provider API anahtarlari ve webhook dogrulamasi eklenmeli.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
