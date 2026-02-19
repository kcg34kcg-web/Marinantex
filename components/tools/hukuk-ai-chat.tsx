'use client';

import { useState, useRef } from 'react';
import {
  BrainCircuit,
  Send,
  BookOpen,
  AlertTriangle,
  Info,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Scale,
  CalendarDays,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

// ─── Types (mirror backend RAGResponse) ─────────────────────────────────────

interface Source {
  doc_id: string;
  title?: string;
  content: string;
  court?: string;
  article_no?: string;
  authority_score?: number;
  final_score?: number;
  version_type?: string;
  aym_warning?: string;
  collected_at?: string;
}

interface AnswerSentence {
  sentence_id: number;
  text: string;
  source_refs: number[];
  is_grounded: boolean;
}

interface LegalDisclaimer {
  disclaimer_text: string;
  severity: 'info' | 'warning' | 'critical';
  requires_expert: boolean;
  disclaimer_types: string[];
}

interface LeheNotice {
  is_applicable: boolean;
  law_domain: string;
  event_date?: string;
  decision_date?: string;
  event_doc_count?: number;
  decision_doc_count?: number;
  reason?: string;
  legal_basis?: string;
}

interface CostEstimate {
  model_id: string;
  input_tokens?: number;
  output_tokens?: number;
  estimated_usd?: number;
}

interface RagResponse {
  answer: string;
  sources: Source[];
  model_used: string;
  tier: number;
  grounding_ratio: number;
  answer_sentences: AnswerSentence[];
  legal_disclaimer?: LegalDisclaimer;
  lehe_kanun_notice?: LeheNotice;
  cost_estimate?: CostEstimate;
  aym_warnings?: { doc_id: string; warning_text: string }[];
}

// ─── Tier badge ──────────────────────────────────────────────────────────────

const TIER_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: 'Hazır Cevap', color: 'bg-green-100 text-green-800' },
  2: { label: 'Düşünceli', color: 'bg-blue-100 text-blue-800' },
  3: { label: 'Kıdemli', color: 'bg-purple-100 text-purple-800' },
  4: { label: 'Muazzam', color: 'bg-orange-100 text-orange-800' },
};

// ─── Component ───────────────────────────────────────────────────────────────

export function HukukAiChat() {
  const [query, setQuery] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [decisionDate, setDecisionDate] = useState('');
  const [showDateFields, setShowDateFields] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<RagResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const payload: Record<string, unknown> = { query: query.trim() };
      if (eventDate) payload.event_date = eventDate;
      if (decisionDate) payload.decision_date = decisionDate;

      const res = await fetch('/api/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error ?? 'Bir hata oluştu.');
      } else {
        setResult(data as RagResponse);
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    } catch {
      setError('Sunucu bağlantı hatası. Backend çalışıyor mu?');
    } finally {
      setIsLoading(false);
    }
  }

  const tier = result ? (TIER_LABELS[result.tier] ?? TIER_LABELS[1]) : null;
  const groundingPct = result ? Math.round(result.grounding_ratio * 100) : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ── Query card ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-3">
          <BrainCircuit className="h-5 w-5 text-blue-600" />
          <CardTitle className="text-base">Sıfır Halüsinasyonlu Hukuk Araştırması</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Textarea
              placeholder="Örn: İhtiyaç nedeniyle tahliye davasının şartları ve Yargıtay kararları nelerdir?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={4}
              className="resize-none text-sm"
              disabled={isLoading}
            />

            {/* Lehe kanun date toggle */}
            <div>
              <button
                type="button"
                onClick={() => setShowDateFields((v) => !v)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
              >
                <CalendarDays className="h-3.5 w-3.5" />
                Lehe Kanun / Zaman Yolculuğu Araması
                {showDateFields ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>

              {showDateFields && (
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Olay Tarihi (event_date)</label>
                    <Input
                      type="date"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      disabled={isLoading}
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Karar Tarihi (decision_date)</label>
                    <Input
                      type="date"
                      value={decisionDate}
                      onChange={(e) => setDecisionDate(e.target.value)}
                      disabled={isLoading}
                      className="text-sm"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">
                Kaynak bulunamazsa sistem otomatik olarak <strong>HTTP 422</strong> verir — LLM çağrılmaz.
              </p>
              <Button type="submit" disabled={isLoading || !query.trim()} className="gap-2">
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Araştırılıyor…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Araştır
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* ── Result ─────────────────────────────────────────────────────── */}
      {result && (
        <div ref={resultRef} className="space-y-4">
          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2">
            {tier && (
              <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', tier.color)}>
                Tier {result.tier} — {tier.label}
              </span>
            )}
            <Badge variant="outline" className="text-xs">
              {result.model_used}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                'text-xs',
                groundingPct === 100
                  ? 'border-green-300 text-green-700'
                  : groundingPct >= 50
                    ? 'border-yellow-300 text-yellow-700'
                    : 'border-red-300 text-red-700',
              )}
            >
              Doğrulama: %{groundingPct}
            </Badge>
            {result.cost_estimate?.estimated_usd !== undefined && (
              <Badge variant="outline" className="text-xs">
                ~${result.cost_estimate.estimated_usd.toFixed(4)}
              </Badge>
            )}
          </div>

          {/* Legal disclaimer */}
          {result.legal_disclaimer && (
            <div
              className={cn(
                'flex items-start gap-3 rounded-lg border p-4 text-sm',
                result.legal_disclaimer.severity === 'critical'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : result.legal_disclaimer.severity === 'warning'
                    ? 'border-yellow-200 bg-yellow-50 text-yellow-800'
                    : 'border-blue-200 bg-blue-50 text-blue-800',
              )}
            >
              {result.legal_disclaimer.severity === 'critical' ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : result.legal_disclaimer.severity === 'warning' ? (
                <Scale className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <p>{result.legal_disclaimer.disclaimer_text}</p>
            </div>
          )}

          {/* Lehe kanun notice */}
          {result.lehe_kanun_notice?.is_applicable && (
            <div className="flex items-start gap-3 rounded-lg border border-purple-200 bg-purple-50 p-4 text-sm text-purple-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Lehe Kanun Uygulanabilir — TCK Madde 7/2</p>
                <p className="mt-1 text-xs">
                  Alan: {result.lehe_kanun_notice.law_domain} | Olay: {result.lehe_kanun_notice.event_date} | Karar:{' '}
                  {result.lehe_kanun_notice.decision_date}
                </p>
                {result.lehe_kanun_notice.legal_basis && (
                  <p className="mt-0.5 text-xs text-purple-600">{result.lehe_kanun_notice.legal_basis}</p>
                )}
              </div>
            </div>
          )}

          {/* AYM warnings */}
          {result.aym_warnings && result.aym_warnings.length > 0 && (
            <div className="space-y-2">
              {result.aym_warnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p>{w.warning_text}</p>
                </div>
              ))}
            </div>
          )}

          {/* Answer */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <BrainCircuit className="h-4 w-4 text-blue-600" />
                Yanıt
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.answer_sentences && result.answer_sentences.length > 0 ? (
                <p className="space-y-0.5 text-sm leading-relaxed text-slate-800">
                  {result.answer_sentences.map((s) => (
                    <span key={s.sentence_id}>
                      <span className={cn(s.is_grounded ? 'text-slate-800' : 'italic text-orange-600')}>{s.text}</span>
                      {s.source_refs.length > 0 && (
                        <sup className="ml-0.5 text-blue-600">[{s.source_refs.join(',')}]</sup>
                      )}{' '}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{result.answer}</p>
              )}
            </CardContent>
          </Card>

          {/* Sources */}
          {result.sources && result.sources.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <button
                  type="button"
                  onClick={() => setExpandedSources((v) => !v)}
                  className="flex w-full items-center justify-between"
                >
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <BookOpen className="h-4 w-4 text-slate-500" />
                    Kaynaklar ({result.sources.length})
                  </CardTitle>
                  {expandedSources ? (
                    <ChevronUp className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  )}
                </button>
              </CardHeader>

              {expandedSources && (
                <CardContent className="space-y-3 pt-0">
                  <Separator />
                  {result.sources.map((src, idx) => (
                    <div key={src.doc_id} className="rounded-md border border-border p-3 text-xs">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-700">
                          [{idx + 1}] {src.title ?? src.doc_id}
                        </span>
                        {src.court && (
                          <Badge variant="outline" className="text-xs">
                            {src.court}
                          </Badge>
                        )}
                        {src.article_no && (
                          <Badge variant="outline" className="text-xs">
                            {src.article_no}
                          </Badge>
                        )}
                        {src.version_type && (
                          <Badge variant="outline" className="bg-purple-50 text-xs text-purple-700">
                            {src.version_type}
                          </Badge>
                        )}
                        {src.aym_warning && (
                          <Badge variant="outline" className="bg-red-50 text-xs text-red-700">
                            AYM İptal
                          </Badge>
                        )}
                        {src.final_score !== undefined && (
                          <span className="ml-auto text-slate-400">skor: {src.final_score.toFixed(3)}</span>
                        )}
                      </div>
                      <p className="line-clamp-3 text-slate-600">{src.content}</p>
                      {src.aym_warning && <p className="mt-1 text-red-600">{src.aym_warning}</p>}
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
