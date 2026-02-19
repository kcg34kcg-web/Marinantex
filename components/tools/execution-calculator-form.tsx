'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/form/money-input';
import { Input } from '@/components/ui/input';
import { calculateExecutionCosts, getExecutionWarnings } from '@/lib/finance/execution';

const schema = z.object({
  collectedAmount: z.string().min(1),
  tahsilHarciRatePercent: z.string().min(1),
  prisonFeeEnabled: z.boolean(),
  prisonFeeRatePercent: z.string().min(1),
  assetType: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

export function ExecutionCalculatorForm() {
  const [resultText, setResultText] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      collectedAmount: '50000',
      tahsilHarciRatePercent: '9.10',
      prisonFeeEnabled: true,
      prisonFeeRatePercent: '2',
      assetType: 'Emekli Maaşı',
    },
  });

  const onSubmit = (values: FormValues) => {
    const result = calculateExecutionCosts({
      collectedAmount: values.collectedAmount,
      tahsilHarciRatePercent: values.tahsilHarciRatePercent,
      prisonFeeEnabled: values.prisonFeeEnabled,
      prisonFeeRatePercent: values.prisonFeeRatePercent,
      rateOverrides: {
        tahsilHarciRatePercent: values.tahsilHarciRatePercent,
        prisonFeeRatePercent: values.prisonFeeRatePercent,
      },
    });

    setWarnings(getExecutionWarnings(values.assetType));
    setResultText(
      [
        `Tahsil Harcı: ${result.tahsilHarciAmount} TL`,
        `Cezaevi Harcı: ${result.prisonFeeAmount} TL`,
        `Toplam Masraf: ${result.totalCost} TL`,
      ].join('\n')
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>İcra Masrafı Analizi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form className="space-y-3" onSubmit={form.handleSubmit(onSubmit)}>
          <MoneyInput placeholder="Tahsil Edilen Tutar" {...form.register('collectedAmount')} />
          <Input placeholder="Tahsil Harcı Oranı (%)" {...form.register('tahsilHarciRatePercent')} />
          <Input placeholder="Cezaevi Harcı Oranı (%)" {...form.register('prisonFeeRatePercent')} />
          <Input placeholder="Varlık Türü" {...form.register('assetType')} />

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.watch('prisonFeeEnabled')} onChange={(event) => form.setValue('prisonFeeEnabled', event.target.checked)} />
            Cezaevi Harcını Uygula
          </label>

          <Button type="submit">Masrafı Hesapla</Button>
        </form>

        {warnings.length > 0 ? (
          <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}

        {resultText ? <pre className="rounded-md border border-border bg-slate-50 p-3 text-sm whitespace-pre-wrap">{resultText}</pre> : null}
      </CardContent>
    </Card>
  );
}
