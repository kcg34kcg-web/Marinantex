'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { calculateMunzamDamage } from '@/lib/finance/munzam';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LedgerEntry } from '@/types/finance';

interface CaseFinancePanelProps {
  caseId: string;
}

interface LedgerApiResponse {
  entries: LedgerEntry[];
}

async function fetchLedger(caseId: string): Promise<LedgerEntry[]> {
  const response = await fetch(`/api/finance/cases/${caseId}/ledger`, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Finans defteri verisi alınamadı.');
  }

  const payload = (await response.json()) as LedgerApiResponse;
  return payload.entries;
}

export function CaseFinancePanel({ caseId }: CaseFinancePanelProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['case-finance-ledger', caseId],
    queryFn: () => fetchLedger(caseId),
  });

  const munzam = useMemo(() => {
    return calculateMunzamDamage({
      principal: '100000',
      inflationRatePercent: '58',
      legalInterestRatePercent: '24',
      usdChangePercent: '32',
      goldChangePercent: '44',
    });
  }, []);

  const handleExportPdf = async () => {
    const reactPdf = await import('@react-pdf/renderer');

    const FinanceReportDocument = (
      <reactPdf.Document>
        <reactPdf.Page size="A4" style={{ padding: 24 }}>
          <reactPdf.Text style={{ fontSize: 14, marginBottom: 12 }}>Dosya Finans Raporu</reactPdf.Text>
          <reactPdf.Text>Dosya No: {caseId}</reactPdf.Text>
          <reactPdf.Text>Munzam Zarar: {munzam.munzamDamage} TL</reactPdf.Text>
          <reactPdf.Text>Enflasyon Bazlı: {munzam.inflationAdjusted} TL</reactPdf.Text>
          <reactPdf.Text>Yasal Faiz Bazlı: {munzam.legalInterestAdjusted} TL</reactPdf.Text>
        </reactPdf.Page>
      </reactPdf.Document>
    );

    const blob = await reactPdf.pdf(FinanceReportDocument).toBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dosya-${caseId}-finans-raporu.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Munzam Zarar Karşılaştırması</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-700">
          <p>Enflasyon Bazlı Artış: {munzam.inflationAdjusted} TL</p>
          <p>Yasal Faiz Bazlı Artış: {munzam.legalInterestAdjusted} TL</p>
          <p>Munzam Zarar Farkı: {munzam.munzamDamage} TL</p>
          <p>USD Kıyas: {munzam.usdBenchmark ?? '-'}</p>
          <p>Altın Kıyas: {munzam.goldBenchmark ?? '-'}</p>
          <Button variant="outline" onClick={handleExportPdf}>
            PDF Raporu Oluştur
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Immutable Finans Defteri</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-slate-500">Defter yükleniyor...</p> : null}
          {isError ? <p className="text-sm text-orange-600">Defter verisi alınamadı.</p> : null}
          {data && data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-2 py-2">Tarih</th>
                    <th className="px-2 py-2">Tür</th>
                    <th className="px-2 py-2">Kategori</th>
                    <th className="px-2 py-2">Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((entry) => (
                    <tr key={entry.id} className="border-b border-border">
                      <td className="px-2 py-2">{entry.transactionDate}</td>
                      <td className="px-2 py-2">{entry.type}</td>
                      <td className="px-2 py-2">{entry.category}</td>
                      <td className="px-2 py-2">{entry.amount} {entry.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
