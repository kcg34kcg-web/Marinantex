'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface OfficeDocumentAnalyzeFormProps {
  activeRole: 'lawyer' | 'assistant';
}

interface AnalyzeResult {
  provider: string;
  status: string;
  message?: string;
  watermark?: string | null;
}

export function OfficeDocumentAnalyzeForm({ activeRole }: OfficeDocumentAnalyzeFormProps) {
  const [documentName, setDocumentName] = useState('Dava Dilekçesi.pdf');
  const [complexity, setComplexity] = useState<'standard' | 'handwritten'>('standard');
  const [googleVisionApproved, setGoogleVisionApproved] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/office/documents/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentName,
          complexity,
          googleVisionApproved,
          viewerRole: activeRole,
          viewerName: activeRole === 'assistant' ? 'Asistan Kullanıcı' : 'Avukat Kullanıcı',
          viewerIp: '127.0.0.1',
        }),
      });

      const data = (await response.json()) as AnalyzeResult;
      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Belge Analizi</CardTitle>
        <p className="text-sm text-slate-500">Belge türüne göre OCR sağlayıcısı ve kalite akışı seçin.</p>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Belge Adı</label>
            <Input value={documentName} onChange={(e) => setDocumentName(e.target.value)} placeholder="Belge adı" />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Belge Tipi</label>
              <select
                value={complexity}
                onChange={(e) => setComplexity(e.target.value as 'standard' | 'handwritten')}
                className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
              >
                <option value="standard">Standart metin (Tesseract)</option>
                <option value="handwritten">El yazısı / karmaşık (Google Vision)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Onay</label>
              <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-white px-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={googleVisionApproved}
                  onChange={(e) => setGoogleVisionApproved(e.target.checked)}
                />
                Google Vision maliyet onayı alındı
              </label>
            </div>
          </div>

          <Button type="submit" disabled={loading}>
            {loading ? 'Analiz ediliyor...' : 'Belgeyi Analiz Et'}
          </Button>
        </form>

        {result ? (
          <div className="mt-4 rounded-xl border border-border bg-slate-50 p-3 text-sm">
            <p>
              Durum: <span className="font-medium">{result.status}</span>
            </p>
            <p>
              Sağlayıcı: <span className="font-medium">{result.provider}</span>
            </p>
            {result.message ? <p className="text-orange-700">{result.message}</p> : null}
            {result.watermark ? (
              <p className="mt-2 text-xs text-slate-600">Watermark: {result.watermark}</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
