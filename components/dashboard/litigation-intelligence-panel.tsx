'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { AlertTriangle, Network, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { calculateAdvisoryLimitationDate } from '@/lib/litigation/prescription';

const CosmographLiveGraph = dynamic(
  () => import('@/components/dashboard/cosmograph-live-graph').then((module) => module.CosmographLiveGraph),
  {
    ssr: false,
    loading: () => <p className="text-sm text-slate-500">Graf bileşeni yükleniyor...</p>,
  }
);

interface LitigationIntelligencePanelProps {
  caseId: string;
}

export function LitigationIntelligencePanel({ caseId }: LitigationIntelligencePanelProps) {
  const [startDate, setStartDate] = useState('2025-01-01');
  const [durationDays, setDurationDays] = useState('365');
  const [accepted, setAccepted] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  const advisory = calculateAdvisoryLimitationDate({
    startDate,
    baseDurationDays: Number(durationDays),
    events: [
      {
        id: 'evt-1',
        caseId,
        eventDate: '2025-06-01',
        eventType: 'tolling_start',
        note: 'Uzlaşma görüşmeleri',
      },
      {
        id: 'evt-2',
        caseId,
        eventDate: '2025-07-01',
        eventType: 'tolling_end',
        note: 'Uzlaşma sona erdi',
      },
    ],
  });

  const acceptAdvisory = async () => {
    const response = await fetch('/api/litigation/limitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        caseId,
        estimatedDate: advisory.estimatedDate,
        accepted,
      }),
    });

    if (!response.ok) {
      setStatusText('Kabul kaydı oluşturulamadı.');
      return;
    }

    setStatusText('Advisory tarih kaydı onaylandı.');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-4 w-4 text-blue-600" />
            5D Zamansal Bilgi Grafı Kokpiti
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>Bu panel, olgusal tarih ve keşif tarihini ayrıştırarak çelişki analizi üretir.</p>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            WebGL/Cosmograph ve Worker tabanlı yerleşim motoru entegrasyonu için mimari hazırlandı.
          </div>
        </CardContent>
      </Card>

      <CosmographLiveGraph caseId={caseId} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            Zamanaşımı Motoru (Danışma Niteliğinde)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <Input value={durationDays} onChange={(event) => setDurationDays(event.target.value)} placeholder="Süre (gün)" />
          </div>
          <p className="text-sm text-slate-700">
            Tahmini Tarih: <strong>{advisory.estimatedDate}</strong>
          </p>
          <p className="text-xs text-orange-700">
            Bu tarih yalnızca "Danışma/Tahmini" niteliktedir. Nihai sorumluluk kullanıcı doğrulamasına tabidir.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            Tarihi inceledim, manuel olarak doğrulayıp kabul ediyorum.
          </label>
          <Button onClick={acceptAdvisory} disabled={!accepted}>
            Kabul & Kayıt Et
          </Button>
          {statusText ? <p className="text-sm text-blue-700">{statusText}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-green-600" />
            Delil Bütünlüğü ve Chain of Custody
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-700">
          OCR → Çıkarım → Grafikleme → Bundle Export adımları SHA-256/Merkle kökü ile doğrulanır.
        </CardContent>
      </Card>
    </div>
  );
}
