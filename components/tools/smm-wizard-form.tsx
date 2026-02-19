'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/form/money-input';
import { Input } from '@/components/ui/input';
import { calculateSmm, getDefaultStopajByStatus } from '@/lib/finance/smm';

const schema = z.object({
  netAmount: z.string().min(1),
  taxpayerStatus: z.enum(['consumer', 'taxpayer']),
  stopajRatePercent: z.string().min(1),
  kdvRatePercent: z.string().min(1),
  tevkifatNumerator: z.string().min(1),
  tevkifatDenominator: z.string().min(1),
  tevkifatEnabled: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

export function SmmWizardForm() {
  const [resultText, setResultText] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      netAmount: '10000',
      taxpayerStatus: 'taxpayer',
      stopajRatePercent: '20',
      kdvRatePercent: '20',
      tevkifatNumerator: '5',
      tevkifatDenominator: '10',
      tevkifatEnabled: false,
    },
  });

  const onSubmit = (values: FormValues) => {
    const result = calculateSmm({
      netAmount: values.netAmount,
      mode: 'net_to_gross',
      taxpayerStatus: values.taxpayerStatus,
      stopajRatePercent: values.stopajRatePercent,
      kdvRatePercent: values.kdvRatePercent,
      tevkifatEnabled: values.tevkifatEnabled,
      tevkifatNumerator: values.tevkifatNumerator,
      tevkifatDenominator: values.tevkifatDenominator,
    });

    setResultText(
      [
        `Brüt Tutar: ${result.grossAmount} TL`,
        `Stopaj: ${result.stopajAmount} TL`,
        `KDV: ${result.kdvAmount} TL`,
        `Tevkifat: ${result.tevkifatAmount} TL`,
        `Toplam Tahsil Edilecek: ${result.totalReceivable} TL`,
      ].join('\n')
    );
  };

  const onTaxpayerStatusChange = (value: 'consumer' | 'taxpayer') => {
    form.setValue('taxpayerStatus', value);
    form.setValue('stopajRatePercent', getDefaultStopajByStatus(value));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>SMM Sihirbazı (GVK 94)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form className="space-y-3" onSubmit={form.handleSubmit(onSubmit)}>
          <MoneyInput placeholder="Net Tutar" {...form.register('netAmount')} />

          <select
            value={form.watch('taxpayerStatus')}
            onChange={(event) => onTaxpayerStatusChange(event.target.value as 'consumer' | 'taxpayer')}
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
          >
            <option value="consumer">Nihai Tüketici</option>
            <option value="taxpayer">Vergi Mükellefi</option>
          </select>

          <Input placeholder="Stopaj Oranı (%)" {...form.register('stopajRatePercent')} />
          <Input placeholder="KDV Oranı (%)" {...form.register('kdvRatePercent')} />

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.watch('tevkifatEnabled')} onChange={(event) => form.setValue('tevkifatEnabled', event.target.checked)} />
            Tevkifat Uygula
          </label>

          <div className="grid gap-2 md:grid-cols-2">
            <Input placeholder="Tevkifat Pay" {...form.register('tevkifatNumerator')} />
            <Input placeholder="Tevkifat Payda" {...form.register('tevkifatDenominator')} />
          </div>

          <Button type="submit">Makbuz Hesapla</Button>
        </form>

        {resultText ? <pre className="rounded-md border border-border bg-slate-50 p-3 text-sm whitespace-pre-wrap">{resultText}</pre> : null}
      </CardContent>
    </Card>
  );
}
