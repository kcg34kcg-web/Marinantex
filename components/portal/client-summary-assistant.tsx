'use client';

import { useState } from 'react';
import { MessageSquareWarning, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ClientSummaryAssistantProps {
  caseId: string;
}

interface ClientSummaryResponse {
  blocked: boolean;
  reason?: string;
  keywords?: string[];
  summary?: string;
  feedbackFlag?: boolean;
  editRatio?: number | null;
}

export function ClientSummaryAssistant({ caseId }: ClientSummaryAssistantProps) {
  const [legalText, setLegalText] = useState('');
  const [originalSummary, setOriginalSummary] = useState('');
  const [editedSummary, setEditedSummary] = useState('');
  const [warningText, setWarningText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editRatio, setEditRatio] = useState<number | null>(null);
  const [feedbackFlag, setFeedbackFlag] = useState(false);

  const generateSummary = async () => {
    if (!legalText.trim()) {
      setWarningText('Lütfen özetlenecek hukuki metni girin.');
      return;
    }

    setIsLoading(true);
    setWarningText(null);

    try {
      const response = await fetch('/api/client-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          legalText,
        }),
      });

      const payload = (await response.json()) as ClientSummaryResponse;

      if (!response.ok || payload.blocked) {
        const keywords = payload.keywords?.join(', ');
        setWarningText(
          payload.reason ??
            (keywords ? `Kritik anahtar kelime tespit edildi: ${keywords}. Avukat onayı gereklidir.` : 'Özet üretilemedi.')
        );
        return;
      }

      const summary = payload.summary ?? '';
      setOriginalSummary(summary);
      setEditedSummary(summary);
      setEditRatio(null);
      setFeedbackFlag(false);
    } catch {
      setWarningText('Özet üretimi sırasında bir hata oluştu.');
    } finally {
      setIsLoading(false);
    }
  };

  const analyzeEdits = async () => {
    if (!legalText.trim() || !originalSummary.trim() || !editedSummary.trim()) {
      setWarningText('Analiz için metin, ilk özet ve düzenlenmiş özet gereklidir.');
      return;
    }

    setIsLoading(true);
    setWarningText(null);

    try {
      const response = await fetch('/api/client-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          legalText,
          originalSummary,
          editedSummary,
        }),
      });

      const payload = (await response.json()) as ClientSummaryResponse;

      if (!response.ok || payload.blocked) {
        setWarningText(payload.reason ?? 'Düzenleme analizi yapılamadı.');
        return;
      }

      setEditRatio(payload.editRatio ?? null);
      setFeedbackFlag(Boolean(payload.feedbackFlag));
    } catch {
      setWarningText('Düzenleme analizi sırasında bir hata oluştu.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-orange-500" />
          Müvekkil Özet Asistanı
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500">Dosya: {caseId}</p>

        <textarea
          className="min-h-28 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Müvekkile açıklanacak hukuki metni buraya yapıştırın..."
          value={legalText}
          onChange={(event) => setLegalText(event.target.value)}
        />

        <Button variant="accent" onClick={generateSummary} disabled={isLoading}>
          {isLoading ? 'Özet Üretiliyor...' : 'Müvekkil Özeti Oluştur'}
        </Button>

        {originalSummary ? (
          <>
            <div className="rounded-md border border-border bg-slate-50 p-3 text-sm">
              <p className="mb-1 font-semibold text-slate-800">İlk Özet</p>
              <p className="text-slate-700">{originalSummary}</p>
            </div>

            <textarea
              className="min-h-24 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Avukat düzenlemesi"
              value={editedSummary}
              onChange={(event) => setEditedSummary(event.target.value)}
            />

            <Button variant="outline" onClick={analyzeEdits} disabled={isLoading}>
              Düzenleme Etkisini Analiz Et
            </Button>
          </>
        ) : null}

        {editRatio !== null ? (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            <p>Düzenleme Oranı: %{(editRatio * 100).toFixed(1)}</p>
            {feedbackFlag ? <p className="mt-1 font-medium">Prompt optimizasyonu için işaretlendi.</p> : null}
          </div>
        ) : null}

        {warningText ? (
          <div className="inline-flex items-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-700">
            <MessageSquareWarning className="h-4 w-4" />
            {warningText}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
