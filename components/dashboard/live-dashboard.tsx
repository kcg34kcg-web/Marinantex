'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AnkaCounselorGreeting } from '@/components/dashboard/anka-counselor-greeting';
import { fetchDashboardCases, fetchDashboardData, type DashboardCaseItem } from '@/lib/queries';
import { formatDateTR } from '@/lib/date';
import { cn } from '@/lib/utils';
import type { CaseStatus } from '@/types';

const WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cts', 'Paz'] as const;
const QUICK_ACTIONS: Array<{
  title: string;
  description: string;
  href: string;
  cta: string;
}> = [
  {
    title: 'Görev Oluştur',
    description: 'Yeni görev formunu tek tıkla aç.',
    href: '/dashboard/tasks?openTask=1',
    cta: 'Görevi Aç',
  },
  {
    title: 'Duruşma Notu',
    description: 'İlk aktif dosya için hızlı not penceresini aç.',
    href: '/dashboard/cases?openNote=1',
    cta: 'Not Ekle',
  },
  {
    title: 'Müvekkile Mesaj',
    description: 'Müvekkil iletişim ekranına hızlı geçiş yap.',
    href: '/dashboard/clients',
    cta: 'Mesaj Ekranı',
  },
];

type RowTone = 'critical' | 'warning' | 'success' | 'neutral';
type CalendarEventKind = 'hearing' | 'service' | 'delivery' | 'deadline' | 'reminder';
type CalendarSource = 'task_deadline' | 'timeline_event' | 'limitation_acceptance' | 'holiday';

type MiniCalendarDayMarkers = {
  hearing: boolean;
  task: boolean;
  holiday: boolean;
  other: boolean;
};

type MiniCalendarData = {
  markersByDay: Map<string, MiniCalendarDayMarkers>;
  itemsByDay: Map<string, MiniCalendarDayItem[]>;
  dayCounts: {
    hearing: number;
    task: number;
    holiday: number;
    other: number;
  };
};

type MiniCalendarDayItem = {
  id: string;
  source: CalendarSource;
  eventKind: CalendarEventKind;
  when: string;
  title: string;
  caseTitle: string | null;
};

type CalendarApiResponse = {
  items?: Array<{
    id: string;
    source: CalendarSource;
    eventKind: CalendarEventKind;
    when: string;
    title: string;
    caseTitle?: string | null;
  }>;
  error?: string;
};

type HolidayApiResponse = {
  items?: Array<{
    id: string;
    date: string;
    name: string;
  }>;
  error?: string;
};

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

function startOfWeekMonday(date: Date): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + offset);
  return copy;
}

function addDays(date: Date, amount: number): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function dateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function dateKeyFromIso(isoString: string): string | null {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return dateKey(date);
}

function isSameDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatDayLabel(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00+03:00`);
  if (Number.isNaN(date.getTime())) {
    return dayKey;
  }

  return format(date, "d MMMM yyyy, EEEE", { locale: tr });
}

function formatTimeLabel(isoString: string, source: CalendarSource): string {
  if (source === 'holiday') {
    return 'Tüm gün';
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function sourceLabel(source: CalendarSource): string {
  if (source === 'task_deadline') return 'Görev';
  if (source === 'timeline_event') return 'Takvim';
  if (source === 'holiday') return 'Resmî Tatil';
  return 'Süre';
}

function eventLabel(kind: CalendarEventKind): string {
  if (kind === 'hearing') return 'Duruşma';
  if (kind === 'deadline') return 'Son Gün';
  if (kind === 'service') return 'Tebligat';
  if (kind === 'delivery') return 'Teslim';
  return 'Hatırlatma';
}

export function LiveDashboard() {
  const [isReady, setIsReady] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedMiniDayKey, setSelectedMiniDayKey] = useState(() => format(new Date(), 'yyyy-MM-dd'));

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
    const nextDeadline = deadlines
      .filter((item) => toDaysUntil(item.date) >= 0)
      .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())[0];

    return {
      activeCaseCount: activeCases.length,
      criticalDeadlineCount,
      upcomingDeadlineCount,
      staleCaseCount,
      missingContextCount,
      nextDeadline,
      rows: [
        {
          title: 'Kritik süreler',
          detail: '3 gün ve altındaki son tarihleri önceliklendir.',
          value: criticalDeadlineCount,
          tone: criticalDeadlineCount > 0 ? ('critical' as const) : ('success' as const),
        },
        {
          title: '7 günlük takip',
          detail: 'Bu hafta kapanması gereken süreler.',
          value: upcomingDeadlineCount,
          tone: upcomingDeadlineCount > 0 ? ('warning' as const) : ('success' as const),
        },
        {
          title: 'Güncellenmeyen dosyalar',
          detail: '10+ gündür aktivite olmayan dosyalar.',
          value: staleCaseCount,
          tone: staleCaseCount > 0 ? ('warning' as const) : ('success' as const),
        },
      ],
    };
  }, [overviewData, casesData]);

  const monthGridDays = useMemo(() => {
    const monthStart = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    const gridStart = startOfWeekMonday(monthStart);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [monthAnchor]);

  const monthFrom = useMemo(() => {
    return format(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1), 'yyyy-MM-dd');
  }, [monthAnchor]);

  const monthTo = useMemo(() => {
    return format(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0), 'yyyy-MM-dd');
  }, [monthAnchor]);

  const { data: miniCalendarData, isLoading: isMiniCalendarLoading } = useQuery<MiniCalendarData, Error>({
    queryKey: ['dashboard', 'mini-calendar-markers', monthFrom, monthTo],
    queryFn: async () => {
      const [calendarResponse, holidayResponse] = await Promise.all([
        fetch(`/api/dashboard/calendar?from=${encodeURIComponent(monthFrom)}&to=${encodeURIComponent(monthTo)}`, {
          cache: 'no-store',
        }),
        fetch(`/api/dashboard/calendar/holidays?from=${encodeURIComponent(monthFrom)}&to=${encodeURIComponent(monthTo)}`, {
          cache: 'no-store',
        }),
      ]);

      const calendarPayload = (await calendarResponse.json()) as CalendarApiResponse;
      if (!calendarResponse.ok) {
        throw new Error(calendarPayload.error ?? 'Takvim verisi alınamadı.');
      }

      const holidayPayload = holidayResponse.ok
        ? ((await holidayResponse.json()) as HolidayApiResponse)
        : ({ items: [] } as HolidayApiResponse);

      const markersByDay = new Map<string, MiniCalendarDayMarkers>();
      const itemsByDay = new Map<string, MiniCalendarDayItem[]>();

      const ensureDayMarker = (dayKey: string) => {
        const existing = markersByDay.get(dayKey);
        if (existing) {
          return existing;
        }

        const created: MiniCalendarDayMarkers = {
          hearing: false,
          task: false,
          holiday: false,
          other: false,
        };
        markersByDay.set(dayKey, created);
        return created;
      };

      const pushDayItem = (dayKey: string, item: MiniCalendarDayItem) => {
        const existing = itemsByDay.get(dayKey) ?? [];
        existing.push(item);
        itemsByDay.set(dayKey, existing);
      };

      (calendarPayload.items ?? []).forEach((item) => {
        const dayKey = dateKeyFromIso(item.when);
        if (!dayKey) {
          return;
        }

        const marker = ensureDayMarker(dayKey);
        if (item.source === 'task_deadline') {
          marker.task = true;
        } else if (item.eventKind === 'hearing') {
          marker.hearing = true;
        } else {
          marker.other = true;
        }

        pushDayItem(dayKey, {
          id: item.id,
          source: item.source,
          eventKind: item.eventKind,
          when: item.when,
          title: item.title,
          caseTitle: item.caseTitle ?? null,
        });
      });

      (holidayPayload.items ?? []).forEach((item) => {
        if (!item.date) {
          return;
        }
        const marker = ensureDayMarker(item.date);
        marker.holiday = true;
        pushDayItem(item.date, {
          id: item.id,
          source: 'holiday',
          eventKind: 'reminder',
          when: `${item.date}T09:00:00+03:00`,
          title: item.name,
          caseTitle: null,
        });
      });

      const dayCounts = {
        hearing: 0,
        task: 0,
        holiday: 0,
        other: 0,
      };

      markersByDay.forEach((marker) => {
        if (marker.hearing) dayCounts.hearing += 1;
        if (marker.task) dayCounts.task += 1;
        if (marker.holiday) dayCounts.holiday += 1;
        if (marker.other) dayCounts.other += 1;
      });

      return {
        markersByDay,
        itemsByDay,
        dayCounts,
      };
    },
  });

  useEffect(() => {
    if (selectedMiniDayKey < monthFrom || selectedMiniDayKey > monthTo) {
      setSelectedMiniDayKey(monthFrom);
    }
  }, [monthFrom, monthTo, selectedMiniDayKey]);

  const selectedMiniDayItems = useMemo(() => {
    const items = miniCalendarData?.itemsByDay.get(selectedMiniDayKey) ?? [];
    return [...items].sort((left, right) => left.when.localeCompare(right.when));
  }, [miniCalendarData, selectedMiniDayKey]);
  const todayKey = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const todayAgendaItems = useMemo(() => {
    const items = miniCalendarData?.itemsByDay.get(todayKey) ?? [];
    return [...items].sort((left, right) => left.when.localeCompare(right.when));
  }, [miniCalendarData, todayKey]);
  const riskAlerts = useMemo(() => {
    const alerts: Array<{ id: string; tone: 'critical' | 'warning'; text: string }> = [];

    if (summary.criticalDeadlineCount > 0) {
      alerts.push({
        id: 'critical-deadline',
        tone: 'critical',
        text: `${summary.criticalDeadlineCount} kritik süre 3 gün içinde doluyor.`,
      });
    }

    if (summary.staleCaseCount > 0) {
      alerts.push({
        id: 'stale-cases',
        tone: 'warning',
        text: `${summary.staleCaseCount} dosya 10+ gündür güncellenmedi.`,
      });
    }

    if (summary.missingContextCount > 0) {
      alerts.push({
        id: 'missing-context',
        tone: 'warning',
        text: `${summary.missingContextCount} aktif dosyada son not/görev izi yok.`,
      });
    }

    return alerts;
  }, [summary.criticalDeadlineCount, summary.missingContextCount, summary.staleCaseCount]);

  const revealClass = isReady ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0';
  const ongoingCases = casesData?.items ?? [];
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
    <div className="space-y-6">
      <AnkaCounselorGreeting className={cn('transition-all duration-500', revealClass)} />

      <section className={cn('grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] transition-all duration-500', revealClass)}>
        <Card className="rounded-[22px] border-slate-200 bg-white shadow-[0_10px_28px_-26px_rgba(15,23,42,0.5)]">
          <CardHeader>
            <CardTitle className="font-serif text-2xl tracking-[-0.01em] text-[#12263e]">Günün Öncelikleri</CardTitle>
            <CardDescription className="text-slate-600">
              Tek panelde kritik süre, hafta içindeki takip ve dosya sağlığı.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {summaryError ? (
              <div className="rounded-xl border border-[#e8d6c9] bg-[#fff8f2] px-4 py-3 text-sm text-[#8b5e32]">{summaryError}</div>
            ) : isOverviewLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={`today-skeleton-${index}`} className="h-[74px] w-full rounded-xl" />
                ))}
              </div>
            ) : (
              <>
                {summary.rows.map((row) => (
                  <div key={row.title} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
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
                  </div>
                ))}

                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <Badge variant="blue">{summary.activeCaseCount} aktif dosya</Badge>
                  <Badge variant={summary.criticalDeadlineCount > 0 ? 'critical' : 'success'}>
                    {summary.criticalDeadlineCount} kritik süre
                  </Badge>
                  <span className="text-xs text-slate-600">
                    Sonraki tarih:{' '}
                    {summary.nextDeadline ? `${formatDateTR(summary.nextDeadline.date)} (${summary.nextDeadline.title})` : 'Planlı kritik tarih yok'}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[22px] border-slate-200 bg-white shadow-[0_10px_28px_-26px_rgba(15,23,42,0.5)]">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="font-serif text-xl tracking-[-0.01em] text-[#12263e]">Mini Takvim</CardTitle>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
                  }
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:border-slate-300"
                  aria-label="Önceki ay"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
                  }
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:border-slate-300"
                  aria-label="Sonraki ay"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <CardDescription>{format(monthAnchor, 'MMMM yyyy', { locale: tr })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {WEEKDAY_LABELS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthGridDays.map((day) => {
                const isCurrentMonth = day.getMonth() === monthAnchor.getMonth();
                const isToday = isSameDate(day, new Date());
                const dayKey = dateKey(day);
                const isSelected = dayKey === selectedMiniDayKey;
                const dayMarker = miniCalendarData?.markersByDay.get(dayKey);
                const hasAnyMarker = Boolean(dayMarker?.hearing || dayMarker?.task || dayMarker?.holiday || dayMarker?.other);

                return (
                  <button
                    type="button"
                    onClick={() => setSelectedMiniDayKey(dayKey)}
                    key={dayKey}
                    className={cn(
                      'relative flex h-8 items-center justify-center rounded-lg text-xs transition-colors',
                      isCurrentMonth ? 'text-slate-700' : 'text-slate-400',
                      isSelected
                        ? 'border border-[#12354f] bg-[#edf4fb] font-semibold text-[#12354f]'
                        : isToday
                          ? 'border border-slate-300 bg-slate-100 font-semibold'
                          : 'bg-slate-50 hover:bg-slate-100',
                    )}
                  >
                    {day.getDate()}
                    {hasAnyMarker ? (
                      <span className="absolute bottom-0.5 flex items-center gap-0.5" aria-hidden="true">
                        {dayMarker?.hearing ? <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> : null}
                        {dayMarker?.task ? <span className="h-1.5 w-1.5 rounded-full bg-orange-500" /> : null}
                        {dayMarker?.holiday ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}
                        {dayMarker?.other ? <span className="h-1.5 w-1.5 rounded-full bg-slate-500" /> : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="space-y-1 pt-1 text-[11px] text-slate-500">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  Duruşma ({miniCalendarData?.dayCounts.hearing ?? 0})
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-orange-500" />
                  Görev ({miniCalendarData?.dayCounts.task ?? 0})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Resmî Tatil ({miniCalendarData?.dayCounts.holiday ?? 0})
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-slate-500" />
                  Diğer ({miniCalendarData?.dayCounts.other ?? 0})
                </span>
              </div>
              {isMiniCalendarLoading ? <p>Takvim işaretleri yükleniyor...</p> : null}
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Seçili Gün</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{formatDayLabel(selectedMiniDayKey)}</p>
              {selectedMiniDayItems.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">Bu gün için kayıt bulunmuyor.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {selectedMiniDayItems.map((item) => (
                    <li key={`mini-day-item-${item.id}`} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-500">{formatTimeLabel(item.when, item.source)}</span>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline">{sourceLabel(item.source)}</Badge>
                          <Badge variant={item.eventKind === 'hearing' ? 'blue' : item.eventKind === 'deadline' ? 'critical' : 'muted'}>
                            {eventLabel(item.eventKind)}
                          </Badge>
                        </div>
                      </div>
                      <p className="mt-1 text-xs font-medium text-slate-800">{item.title}</p>
                      {item.caseTitle ? <p className="mt-0.5 text-[11px] text-slate-500">{item.caseTitle}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className={cn('grid gap-3 md:grid-cols-3 transition-all duration-500', revealClass)}>
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.title}
            href={action.href as never}
            className="group rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_8px_22px_-24px_rgba(15,23,42,0.65)] transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-300"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">Hızlı Aksiyon</p>
            <p className="mt-1 text-sm font-semibold text-[#132b44]">{action.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{action.description}</p>
            <span className="mt-2 inline-flex text-xs font-semibold text-[#12354f] transition-colors group-hover:text-[#0d273c]">
              {action.cta}
            </span>
          </Link>
        ))}
      </section>

      <section className={cn('grid gap-4 xl:grid-cols-2 transition-all duration-500', revealClass)}>
        <Card className="rounded-[22px] border-slate-200 bg-white shadow-[0_10px_28px_-26px_rgba(15,23,42,0.5)]">
          <CardHeader>
            <CardTitle className="font-serif text-xl tracking-[-0.01em] text-[#12263e]">Bugün Ajandası</CardTitle>
            <CardDescription>{formatDayLabel(todayKey)}</CardDescription>
          </CardHeader>
          <CardContent>
            {isMiniCalendarLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-14 w-full rounded-xl" />
              </div>
            ) : todayAgendaItems.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Bugün için planlı duruşma, görev veya takvim kaydı görünmüyor.
              </p>
            ) : (
              <ul className="space-y-2">
                {todayAgendaItems.slice(0, 6).map((item) => (
                  <li key={`today-agenda-${item.id}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-500">{formatTimeLabel(item.when, item.source)}</span>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline">{sourceLabel(item.source)}</Badge>
                        <Badge variant={item.eventKind === 'hearing' ? 'blue' : item.eventKind === 'deadline' ? 'critical' : 'muted'}>
                          {eventLabel(item.eventKind)}
                        </Badge>
                      </div>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-800">{item.title}</p>
                    {item.caseTitle ? <p className="mt-0.5 text-xs text-slate-500">{item.caseTitle}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[22px] border-slate-200 bg-white shadow-[0_10px_28px_-26px_rgba(15,23,42,0.5)]">
          <CardHeader>
            <CardTitle className="font-serif text-xl tracking-[-0.01em] text-[#12263e]">Risk Uyarı Kutusu</CardTitle>
            <CardDescription>Hızlı müdahale gerektiren sinyaller.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {riskAlerts.length === 0 ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                Şu an kritik risk görünmüyor.
              </p>
            ) : (
              riskAlerts.map((alert) => (
                <p
                  key={alert.id}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-sm',
                    alert.tone === 'critical'
                      ? 'border-[#e8cfd0] bg-[#fcf5f5] text-[#8f2d31]'
                      : 'border-[#e7ddcb] bg-[#fdf9f2] text-[#8c6526]',
                  )}
                >
                  {alert.text}
                </p>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <section className={cn('space-y-4 transition-all duration-500', revealClass)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl tracking-[-0.01em] text-[#12263e]">Devam Eden Dosyalar</h2>
            <p className="mt-1 text-sm text-slate-600">Tekrarsız, kısa ve aksiyon odaklı liste.</p>
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
                  style={{ transitionDelay: `${120 + index * 35}ms` }}
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

        {caseWarning ? (
          <p className="rounded-xl border border-[#ebdfcf] bg-[#fdf9f2] px-4 py-2.5 text-xs leading-relaxed text-[#8c6526]">
            {caseWarning}
          </p>
        ) : null}
      </section>
    </div>
  );
}
