'use client';

import { useMemo, useState } from 'react';
import { FileCheck2, Sparkles, ShieldAlert } from 'lucide-react';
import type { PetitionObject } from '@/lib/ai/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

interface PetitionWizardProps {
  caseId: string;
}

interface RefineResponse {
  refinedText: string;
  constraint: string;
}

function parsePetitionResponse(rawText: string): PetitionObject | null {
  try {
    return JSON.parse(rawText) as PetitionObject;
  } catch {
    return null;
  }
}

function isCitationLikelyValid(citation: string): boolean {
  const normalized = citation.toLocaleLowerCase('tr-TR');
  return normalized.includes('m.') || normalized.includes('tbk') || normalized.includes('tmk') || normalized.includes('yargıtay');
}

export function PetitionWizard({ caseId }: PetitionWizardProps) {
  const [caseFacts, setCaseFacts] = useState('');
  const [disputeTopic, setDisputeTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [petition, setPetition] = useState<PetitionObject | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [selectedText, setSelectedText] = useState('');
  const [legalClaim, setLegalClaim] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [refineOutput, setRefineOutput] = useState<RefineResponse | null>(null);

  const allCitations = useMemo(() => {
    if (!petition) {
      return [] as string[];
    }

    return petition.sections.flatMap((section) => section.citations);
  }, [petition]);

  const handleGeneratePetition = async () => {
    if (!caseFacts.trim() || !disputeTopic.trim()) {
      setErrorText('Lütfen uyuşmazlık konusu ve olay özetini doldurun.');
      return;
    }

    setIsGenerating(true);
    setErrorText(null);
    setStreamText('');
    setPetition(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tier: 'drafting',
          outputMode: 'petition',
          messages: [
            {
              role: 'user',
              content: [
                `Dosya No: ${caseId}`,
                `Uyuşmazlık Konusu: ${disputeTopic}`,
                `Vaka Olguları: ${caseFacts}`,
                'Çıktıyı PetitionSchema yapısında üret.',
              ].join('\n'),
            },
          ],
        }),
      });

      if (!response.ok || !response.body) {
        setErrorText('Dilekçe üretimi başarısız oldu.');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        fullResponse += chunk;
        setStreamText(fullResponse);
      }

      const parsed = parsePetitionResponse(fullResponse);

      if (!parsed) {
        setErrorText('Yanıt parse edilemedi. Lütfen tekrar deneyin.');
        return;
      }

      setPetition(parsed);
    } catch {
      setErrorText('Dilekçe üretim servisinde geçici bir sorun oluştu.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStrengthenArgument = async () => {
    if (!selectedText.trim() || !legalClaim.trim() || !caseFacts.trim()) {
      setErrorText('Argüman güçlendirme için tüm alanları doldurun.');
      return;
    }

    setIsRefining(true);
    setErrorText(null);

    try {
      const response = await fetch('/api/refine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          selectedText,
          caseFacts,
          legalClaim,
        }),
      });

      if (!response.ok) {
        setErrorText('Argüman güçlendirme başarısız oldu.');
        return;
      }

      const data = (await response.json()) as RefineResponse;
      setRefineOutput(data);
    } catch {
      setErrorText('Argüman güçlendirme servisi geçici olarak kullanılamıyor.');
    } finally {
      setIsRefining(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-orange-500" />
            Dilekçe Sihirbazı
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Uyuşmazlık konusu (örn: Kira tespit davası)" value={disputeTopic} onChange={(event) => setDisputeTopic(event.target.value)} />
          <textarea
            className="min-h-40 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Olay özetini detaylı yazın..."
            value={caseFacts}
            onChange={(event) => setCaseFacts(event.target.value)}
          />

          <div className="flex gap-2">
            <Button onClick={handleGeneratePetition} disabled={isGenerating}>
              {isGenerating ? 'Dilekçe Üretiliyor...' : 'Dilekçe Oluştur'}
            </Button>
          </div>

          {isGenerating ? <Skeleton className="h-28 w-full" /> : null}

          {petition ? (
            <div className="space-y-4">
              {petition.sections.map((section) => (
                <div key={section.title} className="rounded-md border border-border p-3">
                  <h3 className="mb-2 text-sm font-semibold text-blue-700">{section.title}</h3>
                  <div className="text-sm text-slate-700" dangerouslySetInnerHTML={{ __html: section.content }} />
                </div>
              ))}
            </div>
          ) : streamText ? (
            <pre className="max-h-72 overflow-auto rounded-md border border-border bg-slate-50 p-3 text-xs text-slate-700">{streamText}</pre>
          ) : null}

          {errorText ? (
            <div className="inline-flex items-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-700">
              <ShieldAlert className="h-4 w-4" />
              {errorText}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Atıf Doğrulama</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {allCitations.length === 0 ? (
              <p className="text-slate-600">Henüz doğrulanacak atıf yok.</p>
            ) : (
              allCitations.map((citation) => (
                <div key={citation} className="flex items-center justify-between rounded-md border border-border p-2">
                  <span className="max-w-[75%] truncate">{citation}</span>
                  <span className={isCitationLikelyValid(citation) ? 'text-blue-600' : 'text-orange-600'}>
                    {isCitationLikelyValid(citation) ? 'Olası Uyumlu' : 'Kontrol Et'}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCheck2 className="h-4 w-4 text-blue-600" />
              Argümanı Güçlendir
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input placeholder="Hukuki iddia (örn: Kusur)" value={legalClaim} onChange={(event) => setLegalClaim(event.target.value)} />
            <textarea
              className="min-h-24 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Güçlendirilecek metin"
              value={selectedText}
              onChange={(event) => setSelectedText(event.target.value)}
            />
            <Button variant="outline" onClick={handleStrengthenArgument} disabled={isRefining}>
              {isRefining ? 'Güçlendiriliyor...' : 'Argümanı Güçlendir'}
            </Button>

            {refineOutput ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <p className="mb-2 font-semibold">Güçlendirilmiş Metin</p>
                <p>{refineOutput.refinedText}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
