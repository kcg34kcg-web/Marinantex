'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchDashboardCases, fetchDashboardData, type DashboardCaseItem } from '@/lib/queries';
import { formatDateTR } from '@/lib/date';
import { cn } from '@/lib/utils';
import type { CaseStatus } from '@/types';

const QUICK_ACTIONS: Array<{ title: string; description: string; href: Route; cta: string }> = [
  {
    title: 'Yeni Dosya Akışı',
    description: 'Yeni dosya sürecini düzenli adımlarla başlatın.',
    href: '/dashboard/cases' as Route,
    cta: 'Dosyalara Git',
  },
  {
    title: 'Belge İnceleme',
    description: 'Devam eden belge incelemelerini tek bakışta yönetin.',
    href: '/editor' as Route,
    cta: 'Editörü Aç',
  },
  {
    title: 'Süre ve Takvim',
    description: 'Yaklaşan süreleri ve kritik tarihleri doğrulayın.',
    href: '/dashboard/calendar' as Route,
    cta: 'Takvimi Gör',
  },
  {
    title: 'Hukuk AI Araştırması',
    description: 'Dosya odaklı araştırma ve risk taramasını başlatın.',
    href: '/tools/hukuk-ai' as Route,
    cta: 'Analize Başla',
  },
];

type RowTone = 'critical' | 'warning' | 'success' | 'neutral';

function getRowToneClass(tone: RowTone): string {
  if (tone === 'critical') {
    return 'border-[#e8cfd0] bg-[#fcf5f5] text-[#8f2d31]';
  }

  if (tone === 'warning') {
    return 'border-[#e7ddcb] bg-[#fdf9f2] text-[#8c6526]';
  }

  if (tone === 'success') {
    return 'border-[#d7e8de] bg-[#f3f9f5] text-[#215e42]';
  }

  return 'border-slate-200 bg-white text-[#14314a]';
}

function toDaysUntil(dateValue: string): number {
  const parsedDate = parseISO(dateValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  return differenceInCalendarDays(parsedDate, new Date());
}

function toDaysSince(dateValue: string): number {
  const parsedDate = parseISO(dateValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  return differenceInCalendarDays(new Date(), parsedDate);
}

function getStatusLabel(status: CaseStatus): string {
  if (status === 'open') return 'Açık';
  if (status === 'in_progress') return 'İlerliyor';
  if (status === 'closed') return 'Kapalı';
  return 'Arşiv';
}

function getStatusVariant(status: CaseStatus): 'blue' | 'orange' | 'muted' {
  if (status === 'open') return 'blue';
  if (status === 'in_progress') return 'orange';
  return 'muted';
}

function getLatestActivityDate(item: DashboardCaseItem): string {
  const candidates = [item.updatedAt, item.lastTaskAt, item.lastNoteAt].filter(Boolean) as string[];
  if (candidates.length === 0) return item.updatedAt;

  return candidates.reduce((latest, current) => {
    if (new Date(current).getTime() > new Date(latest).getTime()) {
      return current;
    }
    return latest;
  });
}

export function LiveDashboard() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(true);
  }, []);

  const {
    data: overviewData,
    isLoading: isOverviewLoading,
    isError: isOverviewError,
    error: overviewError,
  } = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: fetchDashboardData,
  });

  const {
    data: casesData,
    isLoading: isCasesLoading,
    isError: isCasesError,
    error: casesError,
  } = useQuery({
    queryKey: ['dashboard', 'home-cases'],
    queryFn: () =>
      fetchDashboardCases({
        page: 1,
        pageSize: 6,
        quickView: 'active',
        sortBy: 'updated_desc',
      }),
  });

  const summary = useMemo(() => {
    const deadlines = overviewData?.deadlines ?? [];
    const caseItems = casesData?.items ?? [];
    const activeCases = caseItems.filter((item) => item.status === 'open' || item.status === 'in_progress');

    const criticalDeadlineCount = deadlines.filter((item) => {
      const days = toDaysUntil(item.date);
      return days >= 0 && days <= 3;
    }).length;

    const upcomingDeadlineCount = deadlines.filter((item) => {
      const days = toDaysUntil(item.date);
      return days >= 0 && days <= 7;
    }).length;

    const staleCaseCount = activeCases.filter((item) => toDaysSince(item.updatedAt) >= 10).length;
    const missingContextCount = activeCases.filter((item) => !item.lastNoteAt && !item.lastTaskAt).length;
    const attentionCount = criticalDeadlineCount + staleCaseCount;

    const nextDeadline = deadlines
      .filter((item) => toDaysUntil(item.date) >= 0)
      .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())[0];

    const todayRows = [
      {
        title: 'Yaklaşan Süreler',
        detail:
          upcomingDeadlineCount > 0
            ? 'Önümüzdeki 7 gün içinde takip edilmesi gereken süreler.'
            : 'Yakın vadede planlanmış süre görünmüyor.',
        value: upcomingDeadlineCount,
        tone: upcomingDeadlineCount > 0 ? ('warning' as const) : ('success' as const),
      },
      {
        title: 'Kritik Aksiyonlar',
        detail:
          criticalDeadlineCount > 0
            ? '3 gün ve altındaki işlemler bugün öncelikli.'
            : 'Bugün kritik aksiyon görünmüyor.',
        value: criticalDeadlineCount,
        tone: criticalDeadlineCount > 0 ? ('critical' as const) : ('success' as const),
      },
      {
        title: 'Bekleyen İncelemeler',
        detail:
          activeCases.length > 0
            ? 'Açık veya ilerleyen dosyalar inceleme bekliyor.'
            : 'Aktif dosya görünmüyor.',
        value: activeCases.length,
        tone: activeCases.length > 0 ? ('neutral' as const) : ('success' as const),
      },
      {
        title: 'Eksik Belge Kontrolü',
        detail:
          missingContextCount > 0
            ? 'Son not veya görev kaydı bulunmayan dosyalar var.'
            : 'Eksik belge/ek sinyali görünmüyor.',
        value: missingContextCount,
        tone: missingContextCount > 0 ? ('warning' as const) : ('success' as const),
      },
    ];

    const insightRows = [
      {
        title: 'Yüksek Riskli Dosya',
        value: `${attentionCount} dosya`,
        note:
          attentionCount > 0
            ? 'Kritik süre ve geciken güncelleme birleşik riski.'
            : 'Bugün yüksek riskli dosya görünmüyor.',
      },
      {
        title: 'Eksik Ek / Not Tespiti',
        value: `${missingContextCount} dosya`,
        note: 'Aktif dosyalarda son not ve görev izi kontrolü.',
      },
      {
        title: 'En Yakın Kritik Tarih',
        value: nextDeadline ? formatDateTR(nextDeadline.date) : 'Planlı kritik tarih yok',
        note: nextDeadline ? nextDeadline.title : 'Takvim sakin ilerliyor.',
      },
    ];

    return {
      todayRows,
      insightRows,
      staleCaseCount,
    };
  }, [overviewData, casesData]);

  const revealClass = isReady ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0';
  const ongoingCases = casesData?.items ?? [];
  const briefingText =
    overviewData?.briefingText ??
    'Bugünün öncelikleri, süre yönetimi ve dosya incelemeleri için tek panelde özetlenir.';
  const summaryError = isOverviewError
    ? overviewError instanceof Error
      ? overviewError.message
      : 'Özet verisi alınamadı.'
    : null;
  const caseWarning =
    isCasesError && !isCasesLoading
      ? casesError instanceof Error
        ? casesError.message
        : 'Dosya verisinin bir bölümü yüklenemedi.'
      : null;

  return (
    <div className="space-y-7">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {QUICK_ACTIONS.map((action, index) => (
          <Link
            key={action.title}
            href={action.href}
            className={cn(
              'group rounded-[18px] border border-slate-200 bg-white p-5 shadow-[0_8px_24px_-24px_rgba(15,23,42,0.55)] transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-300',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#12354f]/30',
              revealClass,
            )}
            style={{ transitionDelay: `${70 + index * 55}ms` }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Hızlı Aksiyon</p>
            <h2 className="mt-2 text-base font-semibold tracking-[-0.01em] text-[#11263d]">{action.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{action.description}</p>
            <span className="mt-4 inline-flex text-xs font-semibold tracking-[0.01em] text-[#12354f] transition-colors group-hover:text-[#0c2539]">
              {action.cta}
            </span>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card
          className={cn(
            'rounded-[22px] border-slate-200 bg-white shadow-[0_10px_28px_-26px_rgba(15,23,42,0.5)] transition-all duration-500',
            revealClass,
          )}
          style={{ transitionDelay: '180ms' }}
        >
          <CardHeader>
            <CardTitle className="font-serif text-2xl tracking-[-0.01em] text-[#12263e]">Bugün</CardTitle>
            <CardDescription className="max-w-2xl leading-relaxed text-slate-600">{briefingText}</CardDescription>
          </CardHeader>
          <CardContent>
            {summaryError ? (
              <div className="rounded-xl border border-[#e8d6c9] bg-[#fff8f2] px-4 py-3 text-sm text-[#8b5e32]">{summaryError}</div>
            ) : isOverviewLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={`today-skeleton-${index}`} className="h-[74px] w-full rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {caseWarning ? (
                  <p className="rounded-xl border border-[#ebdfcf] bg-[#fdf9f2] px-4 py-2.5 text-xs leading-relaxed text-[#8c6526]">
                    {caseWarning}
                  </p>
                ) : null}
                <ul className="space-y-3">
                  {summary.todayRows.map((row) => (
                    <li
                      key={row.title}
                      className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#132b44]">{row.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500">{row.detail}</p>
                      </div>
                      <span
                        className={cn(
                          'inline-flex min-w-10 items-center justify-center rounded-lg border px-2.5 py-1 text-xs font-semibold',
                          getRowToneClass(row.tone),
                        )}
                      >
                        {row.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          className={cn(
            'rounded-[22px] border-slate-200 bg-white shadow-[0_10px_28px_-26px_rgba(15,23,42,0.5)] transition-all duration-500',
            revealClass,
          )}
          style={{ transitionDelay: '220ms' }}
        >
          <CardHeader>
            <CardTitle className="font-serif text-xl tracking-[-0.01em] text-[#12263e]">Hızlı İçgörü</CardTitle>
            <CardDescription className="text-slate-600">İş akışını etkileyen kısa özetler.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isOverviewLoading ? (
              <>
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </>
            ) : (
              <>
                {caseWarning ? (
                  <p className="rounded-xl border border-[#ebdfcf] bg-[#fdf9f2] px-4 py-2.5 text-xs leading-relaxed text-[#8c6526]">
                    {caseWarning}
                  </p>
                ) : null}
                {summary.insightRows.map((item) => (
                  <div key={item.title} className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.11em] text-slate-500">{item.title}</p>
                    <p className="mt-1 text-sm font-semibold text-[#11263d]">{item.value}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{item.note}</p>
                  </div>
                ))}
                <p className="text-[11px] leading-relaxed text-slate-500">
                  {summary.staleCaseCount > 0
                    ? `${summary.staleCaseCount} dosya 10+ gündür güncellenmedi; kısa kontrol önerilir.`
                    : 'Güncel çalışma akışı dengeli ilerliyor.'}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <section
        className={cn('space-y-4 transition-all duration-500', revealClass)}
        style={{ transitionDelay: '260ms' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl tracking-[-0.01em] text-[#12263e]">Devam Edenler</h2>
            <p className="mt-1 text-sm text-slate-600">Açık dosyalar ve son çalışmaların kısa listesi.</p>
          </div>
          <Link
            href={'/dashboard/cases' as Route}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold tracking-[0.01em] text-[#12354f] transition-colors hover:border-slate-300 hover:text-[#0d273c]"
          >
            Tüm Dosyaları Gör
          </Link>
        </div>

        {isCasesError ? (
          <div className="rounded-xl border border-[#e8d6c9] bg-[#fff8f2] px-4 py-3 text-sm text-[#8b5e32]">
            {casesError instanceof Error ? casesError.message : 'Devam eden dosyalar yüklenemedi.'}
          </div>
        ) : isCasesLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={`ongoing-skeleton-${index}`} className="h-[154px] w-full rounded-xl" />
            ))}
          </div>
        ) : ongoingCases.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">
            Devam eden dosya bulunamadı. Yeni çalışma başlatmak için dosya ekranına geçebilirsiniz.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ongoingCases.map((item, index) => {
              const activityDate = getLatestActivityDate(item);
              return (
                <article
                  key={item.id}
                  className={cn(
                    'rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-[0_8px_22px_-24px_rgba(15,23,42,0.65)] transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-300',
                    revealClass,
                  )}
                  style={{ transitionDelay: `${320 + index * 40}ms` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-[#132b44]">{item.title}</h3>
                    <Badge variant={getStatusVariant(item.status)} className="shrink-0">
                      {getStatusLabel(item.status)}
                    </Badge>
                  </div>

                  <p className="mt-3 text-xs text-slate-500">{item.clientName || 'Müvekkil bilgisi eklenmedi.'}</p>
                  <p className="mt-1 text-xs text-slate-500" suppressHydrationWarning>
                    Son aktivite: {formatDateTR(activityDate)}
                  </p>

                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-[0.09em] text-slate-400">Çalışma kartı</span>
                    <Link
                      href={`/dashboard/cases/${item.id}` as Route}
                      className="text-xs font-semibold tracking-[0.01em] text-[#12354f] transition-colors hover:text-[#0d273c]"
                    >
                      Detaya Git
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
