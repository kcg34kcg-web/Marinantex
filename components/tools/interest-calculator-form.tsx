'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/form/money-input';
import { DateRangePicker } from '@/components/form/date-range-picker';
import { calculateVariableInterest } from '@/lib/finance/interest';
import { allocatePaymentByTbk100 } from '@/lib/finance/tbk100';

const formSchema = z.object({
  principal: z.string().min(1),
  expenseBalance: z.string().min(1),
  accruedInterest: z.string().min(1),
  paymentAmount: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  annualRatePercent: z.string().min(1),
});

type FormValues = z.infer<typeof formSchema>;

export function InterestCalculatorForm() {
  const [summary, setSummary] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      principal: '100000',
      expenseBalance: '1500',
      accruedInterest: '7000',
      paymentAmount: '6000',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      annualRatePercent: '24',
    },
  });

  const startDate = form.watch('startDate');
  const endDate = form.watch('endDate');

  const onSubmit = (values: FormValues) => {
    const variableInterest = calculateVariableInterest({
      principal: values.principal,
      startDate: values.startDate,
      endDate: values.endDate,
      rateRows: [{ effective_date: values.startDate, rate_annual: values.annualRatePercent }],
    });

    const allocation = allocatePaymentByTbk100({
      principal: values.principal,
      expenseBalance: values.expenseBalance,
      accruedInterest: values.accruedInterest,
      paymentAmount: values.paymentAmount,
    });

    setSummary(
      [
        `Dönem faizi toplamı: ${variableInterest.totalInterest} TL`,
        `TBK 100 dağılımı -> Masraf: ${allocation.allocatedToExpense} TL, Faiz: ${allocation.allocatedToInterest} TL, Anapara: ${allocation.allocatedToPrincipal} TL`,
        `Kalan anapara: ${allocation.remainingPrincipal} TL`,
      ].join('\n')
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Zamana Duyarlı Faiz Hesaplayıcı (TBK 100)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form className="space-y-3" onSubmit={form.handleSubmit(onSubmit)}>
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={(value) => form.setValue('startDate', value)}
            onEndDateChange={(value) => form.setValue('endDate', value)}
          />
          <MoneyInput placeholder="Anapara" {...form.register('principal')} />
          <MoneyInput placeholder="Masraf Bakiyesi" {...form.register('expenseBalance')} />
          <MoneyInput placeholder="Birikmiş Faiz" {...form.register('accruedInterest')} />
          <MoneyInput placeholder="Ödeme Tutarı" {...form.register('paymentAmount')} />
          <MoneyInput placeholder="Yıllık Faiz Oranı (%)" {...form.register('annualRatePercent')} />
          <Button type="submit">Hesapla</Button>
        </form>

        {summary ? <pre className="rounded-md border border-border bg-slate-50 p-3 text-sm whitespace-pre-wrap">{summary}</pre> : null}
      </CardContent>
    </Card>
  );
}
