'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useQuery } from '@tanstack/react-query';
import { differenceInDays, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LegalDocumentSkeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { fetchDashboardData } from '@/lib/queries';
import { formatDateTR } from '@/lib/date';
import { BrainCircuit, ArrowRight, AlertTriangle, Clock, CheckCircle2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

function DeadlineUrgency({ date }: { date: string }) {
  const days = differenceInDays(parseISO(date), new Date());
  if (days < 0) return <Badge variant="critical">Geçti</Badge>;
  if (days <= 3) return <Badge variant="critical">{days} gün kaldı</Badge>;
  if (days <= 7) return <Badge variant="warning">{days} gün kaldı</Badge>;
  return <Badge variant="success">{days} gün kaldı</Badge>;
}

function deadlineRowClass(date: string): string {
  const days = differenceInDays(parseISO(date), new Date());
  if (days <= 3) return 'border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900';
  if (days <= 7) return 'border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-900';
  return 'border-legal-success/20 bg-green-50/50 dark:bg-green-950/20 dark:border-green-900';
}

export function LiveDashboard() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: fetchDashboardData,
  });

  const urgentCount = data?.deadlines.filter((d) => differenceInDays(parseISO(d.date), new Date()) <= 3).length ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Outcome-First Hero: kritik son tarihleri öne al ────────── */}
      {!isLoading && urgentCount > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-4">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">
            {urgentCount} kritik son tarih — 3 gün veya daha az kaldı
          </p>
        </div>
      )}

      {/* ── Hukuk AI shortcut ──────────────────────────────────────── */}
      <Card className="overflow-hidden border-legal-action/20 bg-gradient-to-br from-legal-primary via-[#1e3a8a] to-legal-action dark:from-slate-900 dark:to-slate-800 shadow-legal-lg">
        <CardContent className="flex items-center justify-between p-5">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-white/10 p-3 backdrop-blur-sm ring-1 ring-white/20">
              <BrainCircuit className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="font-serif text-base font-semibold text-white">Hukuk AI Araştırması</p>
              <p className="text-xs text-blue-200/80">Sıfır Halüsinasyonlu · Zero-Trust RAG v2.1</p>
            </div>
          </div>
          <Link
            href={'/tools/hukuk-ai' as Route}
            className="inline-flex items-center gap-1.5 rounded-xl min-h-[44px] bg-white px-4 py-2 text-sm font-semibold text-legal-primary shadow-legal-sm transition-all hover:bg-white/90 hover:shadow-legal-md hover:-translate-y-0.5"
          >
            Araştırma Yap
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>

      {/* ── Günaydın Özeti ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="font-serif">Günaydın Özeti</CardTitle>
          <CardDescription>Bugünkü çalışma özeti ve önemli notlar</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LegalDocumentSkeleton label="Yükleniyor..." />
          ) : isError ? (
            <div className="flex items-center gap-2 text-sm text-orange-600">
              <AlertTriangle className="h-4 w-4" />
              {error instanceof Error ? error.message : 'Veri alınamadı.'}
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-legal-primary/80 dark:text-slate-300">{data?.briefingText}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Yaklaşan Son Tarihler ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="font-serif">Yaklaşan Son Tarihler</CardTitle>
              <CardDescription>Takvim görünümü — renkler aciliyeti gösterir</CardDescription>
            </div>
            <div className="flex items-center gap-3 text-xs text-legal-primary/50 dark:text-slate-500">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" /> güvenli
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3 text-yellow-500" /> yaklaşıyor
              </span>
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-red-500" /> kritik
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <LegalDocumentSkeleton label="Takvim yükleniyor..." />
              <LegalDocumentSkeleton label="Takvim yükleniyor..." />
              <LegalDocumentSkeleton label="Takvim yükleniyor..." />
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 text-sm text-orange-600">
              <AlertTriangle className="h-4 w-4" />
              Takvim verileri yüklenemedi.
            </div>
          ) : data && data.deadlines.length > 0 ? (
            <ul className="space-y-2">
              {data.deadlines.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    'flex items-center justify-between rounded-xl border p-3 text-sm transition-all',
                    deadlineRowClass(item.date),
                  )}
                >
                  <span className="font-medium text-legal-primary dark:text-slate-200">{item.title}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-legal-primary/50 dark:text-slate-400" suppressHydrationWarning>
                      {formatDateTR(item.date)}
                    </span>
                    <DeadlineUrgency date={item.date} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 py-4 text-sm text-legal-primary/50">
              <Sparkles className="h-4 w-4 text-legal-success" />
              Yaklaşan son tarih görünmüyor — harika!
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
