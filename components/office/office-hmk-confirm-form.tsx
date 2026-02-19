'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { calculateEstimatedHmkDeadline } from '@/lib/office/hmk';

export function OfficeHmkConfirmForm() {
  const [caseId, setCaseId] = useState('00000000-0000-0000-0000-000000000000');
  const [serviceDate, setServiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [accepted, setAccepted] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const estimated = useMemo(() => calculateEstimatedHmkDeadline(serviceDate, 14), [serviceDate]);

  async function confirmDeadline() {
    setStatus(null);
    const response = await fetch('/api/office/hmk/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId,
        serviceDate,
        estimatedDate: estimated.estimatedDate,
        accepted,
      }),
    });

    if (!response.ok) {
      setStatus('HMK onayı kaydedilemedi. Case ID gerçek UUID formatında olmalı.');
      return;
    }

    setStatus('HMK onayı başarıyla kaydedildi.');
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">HMK Süre Danışmanlığı</CardTitle>
        <p className="text-sm text-slate-500">Tebligat tarihine göre tahmini süreyi kontrol edin ve manuel onay verin.</p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Dosya UUID</label>
          <Input value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="Case UUID" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Tebligat Tarihi</label>
          <Input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} />
        </div>
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-orange-800">
          <p>Tahmini son tarih: {estimated.estimatedDate}</p>
          <p className="text-xs">{estimated.warning}</p>
        </div>
        <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          Uyarıyı okudum, manuel kontrol ettim ve sorumluluğu kabul ederek kaydediyorum.
        </label>
        <Button type="button" disabled={!accepted} onClick={confirmDeadline}>
          Onayla ve Kaydet
        </Button>
        {status ? <p className="text-xs text-slate-600">{status}</p> : null}
      </CardContent>
    </Card>
  );
}
