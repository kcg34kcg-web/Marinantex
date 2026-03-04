'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

type CalendarCaseItem = {
  id: string;
  title: string;
  fileNo: string | null;
  status: 'open' | 'in_progress' | 'closed' | 'archived';
};

type CalendarEventKind = 'hearing' | 'service' | 'delivery' | 'deadline' | 'reminder';
type CalendarTemporalStatus = 'overdue' | 'today' | 'upcoming';
type CalendarSource = 'task_deadline' | 'timeline_event' | 'limitation_acceptance';

type CalendarListItem = {
  id: string;
  source: CalendarSource;
  eventKind: CalendarEventKind;
  temporalStatus: CalendarTemporalStatus;
  when: string;
  title: string;
  description: string | null;
  caseId: string;
  caseTitle: string;
  caseFileNo: string | null;
  priority: 'low' | 'normal' | 'high' | null;
  taskStatus: 'open' | 'in_progress' | 'done' | null;
};

type CalendarResponse = {
  range: { from: string; to: string };
  summary: { total: number; overdue: number; today: number; upcoming: number };
  cases: CalendarCaseItem[];
  items: CalendarListItem[];
};

const EVENT_KIND_OPTIONS: Array<{ value: CalendarEventKind; label: string }> = [
  { value: 'hearing', label: 'Durusma' },
  { value: 'service', label: 'Tebligat' },
  { value: 'delivery', label: 'Teslim' },
  { value: 'deadline', label: 'Son Gun' },
  { value: 'reminder', label: 'Hatirlatma' },
];

const SELECT_CLASS_NAME =
  'h-11 w-full rounded-xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-1,var(--surface))] px-3 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring,var(--primary))]';

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysDateOnly(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) {
    return new Date();
  }

  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function addDaysLocal(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeekMonday(date: Date) {
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDaysLocal(date, mondayOffset);
}

function toLocalDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toLocalDateKeyFromIso(isoString: string) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return toLocalDateKey(date);
}

function toDateTimeLocal(isoString: string) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTimeTR(isoString: string) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('tr-TR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimeTR(isoString: string) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function eventKindLabel(kind: CalendarEventKind) {
  if (kind === 'hearing') return 'Durusma';
  if (kind === 'service') return 'Tebligat';
  if (kind === 'delivery') return 'Teslim';
  if (kind === 'deadline') return 'Son Gun';
  return 'Hatirlatma';
}

function sourceLabel(source: CalendarSource) {
  if (source === 'task_deadline') return 'Gorev';
  if (source === 'timeline_event') return 'Takvim Event';
  return 'Sure Onayi';
}

function eventKindVariant(kind: CalendarEventKind): 'blue' | 'orange' | 'critical' | 'muted' {
  if (kind === 'hearing') return 'blue';
  if (kind === 'service' || kind === 'delivery') return 'orange';
  if (kind === 'deadline') return 'critical';
  return 'muted';
}

function temporalStatusVariant(status: CalendarTemporalStatus): 'critical' | 'warning' | 'success' {
  if (status === 'overdue') return 'critical';
  if (status === 'today') return 'warning';
  return 'success';
}

function temporalStatusLabel(status: CalendarTemporalStatus) {
  if (status === 'overdue') return 'Gecmis';
  if (status === 'today') return 'Bugun';
  return 'Yaklasan';
}

function formatWeekDayHeader(date: Date) {
  return date.toLocaleDateString('tr-TR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

function formatWeekRangeLabel(start: Date, end: Date) {
  const startLabel = start.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
  const endLabel = end.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${startLabel} - ${endLabel}`;
}

export function CalendarWorkspace() {
  const [fromDate, setFromDate] = useState(todayDateOnly());
  const [toDate, setToDate] = useState(plusDaysDateOnly(30));
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'week'>('list');
  const [weekAnchorDate, setWeekAnchorDate] = useState(todayDateOnly());

  const [newCaseId, setNewCaseId] = useState('');
  const [newEventKind, setNewEventKind] = useState<CalendarEventKind>('hearing');
  const [newScheduledAt, setNewScheduledAt] = useState(toDateTimeLocal(new Date(Date.now() + 60 * 60 * 1000).toISOString()));
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const weekStartDate = useMemo(() => startOfWeekMonday(parseDateOnly(weekAnchorDate)), [weekAnchorDate]);
  const weekEndDate = useMemo(() => addDaysLocal(weekStartDate, 6), [weekStartDate]);
  const effectiveFrom = viewMode === 'week' ? toLocalDateKey(weekStartDate) : fromDate;
  const effectiveTo = viewMode === 'week' ? toLocalDateKey(weekEndDate) : toDate;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<CalendarResponse, Error>({
    queryKey: ['dashboard', 'calendar', selectedCaseId, viewMode, effectiveFrom, effectiveTo],
    queryFn: async () => {
      const search = new URLSearchParams({
        from: effectiveFrom,
        to: effectiveTo,
      });

      if (selectedCaseId) {
        search.set('caseId', selectedCaseId);
      }

      const response = await fetch(`/api/dashboard/calendar?${search.toString()}`, {
        cache: 'no-store',
      });

      const payload = (await response.json()) as CalendarResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Takvim verisi alinamadi.');
      }

      return payload;
    },
  });

  const items = data?.items ?? [];
  const cases = data?.cases ?? [];
  const summary = data?.summary ?? { total: 0, overdue: 0, today: 0, upcoming: 0 };

  useEffect(() => {
    if (newCaseId) {
      return;
    }

    if (cases.length > 0) {
      setNewCaseId(cases[0].id);
    }
  }, [cases, newCaseId]);

  const groupedItems = useMemo(() => {
    return items.reduce<Record<string, CalendarListItem[]>>((acc, item) => {
      const key = item.when.slice(0, 10);
      const current = acc[key] ?? [];
      current.push(item);
      acc[key] = current;
      return acc;
    }, {});
  }, [items]);

  const sortedDays = useMemo(() => Object.keys(groupedItems).sort(), [groupedItems]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDaysLocal(weekStartDate, index)), [weekStartDate]);
  const weekItemsByDay = useMemo(() => {
    const map = new Map<string, CalendarListItem[]>();
    items.forEach((item) => {
      const key = toLocalDateKeyFromIso(item.when);
      if (!key) {
        return;
      }

      const current = map.get(key) ?? [];
      current.push(item);
      map.set(key, current);
    });

    map.forEach((value, key) => {
      map.set(
        key,
        [...value].sort((left, right) => {
          return left.when.localeCompare(right.when);
        }),
      );
    });

    return map;
  }, [items]);

  async function createCalendarEvent() {
    if (!newCaseId) {
      setFormMessage('Lutfen bir dosya secin.');
      return;
    }

    if (newTitle.trim().length < 3) {
      setFormMessage('Baslik en az 3 karakter olmali.');
      return;
    }

    if (!newScheduledAt) {
      setFormMessage('Tarih ve saat seciniz.');
      return;
    }

    const scheduledAtDate = new Date(newScheduledAt);
    if (Number.isNaN(scheduledAtDate.getTime())) {
      setFormMessage('Tarih formati gecersiz.');
      return;
    }
    const scheduledAtIso = scheduledAtDate.toISOString();

    setIsSubmitting(true);
    setFormMessage(null);

    try {
      const response = await fetch('/api/dashboard/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: newCaseId,
          title: newTitle.trim(),
          description: newDescription.trim() || undefined,
          eventKind: newEventKind,
          scheduledAt: scheduledAtIso,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setFormMessage(payload.error ?? 'Takvim event olusturulamadi.');
        return;
      }

      setFormMessage('Takvim event eklendi.');
      setNewTitle('');
      setNewDescription('');
      setNewEventKind('hearing');
      setNewScheduledAt(toDateTimeLocal(new Date(Date.now() + 60 * 60 * 1000).toISOString()));
      await refetch();
    } catch {
      setFormMessage('Takvim event kaydi sirasinda ag hatasi olustu.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Takvim</CardTitle>
              <CardDescription>Aralik sec, dosya filtrele, sonra event akisini izle.</CardDescription>
            </div>
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={
                  viewMode === 'list'
                    ? 'rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white'
                    : 'rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100'
                }
              >
                Liste
              </button>
              <button
                type="button"
                onClick={() => setViewMode('week')}
                className={
                  viewMode === 'week'
                    ? 'rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white'
                    : 'rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100'
                }
              >
                Haftalik
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {viewMode === 'list' ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Baslangic</label>
                <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="h-11" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Bitis</label>
                <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="h-11" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Dosya Filtresi</label>
                <select
                  value={selectedCaseId}
                  onChange={(event) => setSelectedCaseId(event.target.value)}
                  className={SELECT_CLASS_NAME}
                >
                  <option value="">Tum dosyalar</option>
                  {cases.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="w-full rounded-xl"
                  size="sm"
                >
                  {isFetching ? 'Yenileniyor...' : 'Yenile'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-[1fr_220px]">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium text-slate-500">Hafta Araligi</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    onClick={() => setWeekAnchorDate(toLocalDateKey(addDaysLocal(weekStartDate, -7)))}
                  >
                    Onceki
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    onClick={() => setWeekAnchorDate(todayDateOnly())}
                  >
                    Bugun
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    onClick={() => setWeekAnchorDate(toLocalDateKey(addDaysLocal(weekStartDate, 7)))}
                  >
                    Sonraki
                  </Button>
                  <span className="ml-auto text-sm font-medium text-slate-700">{formatWeekRangeLabel(weekStartDate, weekEndDate)}</span>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Dosya Filtresi</label>
                  <select
                    value={selectedCaseId}
                    onChange={(event) => setSelectedCaseId(event.target.value)}
                    className={SELECT_CLASS_NAME}
                  >
                    <option value="">Tum dosyalar</option>
                    {cases.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="w-full rounded-xl"
                    size="sm"
                  >
                    {isFetching ? 'Yenileniyor...' : 'Yenile'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">Toplam</p>
              <p className="text-2xl font-semibold text-slate-900">{summary.total}</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-xs text-red-600/80">Gecmis</p>
              <p className="text-2xl font-semibold text-red-600">{summary.overdue}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs text-amber-700/80">Bugun</p>
              <p className="text-2xl font-semibold text-amber-600">{summary.today}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-xs text-emerald-700/80">Yaklasan</p>
              <p className="text-2xl font-semibold text-emerald-600">{summary.upcoming}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hizli Event Ekle</CardTitle>
          <CardDescription>Durusma, tebligat, teslim veya son gun kaydini tek adimda ac.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Dosya</label>
              <select
                value={newCaseId}
                onChange={(event) => setNewCaseId(event.target.value)}
                className={SELECT_CLASS_NAME}
              >
                {cases.length === 0 ? <option value="">Dosya bulunamadi</option> : null}
                {cases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">Event Turu</label>
              <select
                value={newEventKind}
                onChange={(event) => setNewEventKind(event.target.value as CalendarEventKind)}
                className={SELECT_CLASS_NAME}
              >
                {EVENT_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Tarih-Saat</label>
              <Input
                type="datetime-local"
                value={newScheduledAt}
                onChange={(event) => setNewScheduledAt(event.target.value)}
                className="h-11"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Baslik</label>
              <Input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Orn: Durusma hazirligi"
                className="h-11"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500">Not</label>
            <Textarea
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              placeholder="Opsiyonel aciklama"
              className="min-h-[96px]"
            />
          </div>

          {formMessage ? <p className="text-xs text-slate-600">{formMessage}</p> : null}

          <div className="flex justify-end">
            <Button type="button" onClick={createCalendarEvent} disabled={isSubmitting} className="rounded-xl px-6" size="sm">
              {isSubmitting ? 'Kaydediliyor...' : 'Event Ekle'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Takvim Akisi</CardTitle>
          <CardDescription>{viewMode === 'week' ? 'Haftalik takvim gorunumu' : 'Tarih sirali event listesi'}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : isError ? (
            <p className="text-sm text-orange-600">{error instanceof Error ? error.message : 'Takvim verisi alinamadi.'}</p>
          ) : viewMode === 'week' ? (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <div className="grid min-w-[980px] grid-cols-7 gap-3">
                  {weekDays.map((day) => {
                    const dayKey = toLocalDateKey(day);
                    const dayItems = weekItemsByDay.get(dayKey) ?? [];
                    return (
                      <section key={dayKey} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{formatWeekDayHeader(day)}</p>
                          <p className="text-xs text-slate-600">{dayItems.length} kayit</p>
                        </div>
                        <ul className="max-h-[360px] space-y-2 overflow-y-auto p-2">
                          {dayItems.length === 0 ? (
                            <li className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-400">
                              Kayit yok
                            </li>
                          ) : (
                            dayItems.map((item) => (
                              <li key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
                                <p className="text-[11px] font-semibold text-slate-500">{formatTimeTR(item.when)}</p>
                                <p className="mt-1 break-words text-xs font-medium text-slate-800">{item.title}</p>
                                <div className="mt-2 flex items-center gap-1">
                                  <Badge variant={eventKindVariant(item.eventKind)} className="text-[10px]">
                                    {eventKindLabel(item.eventKind)}
                                  </Badge>
                                  <Badge variant={temporalStatusVariant(item.temporalStatus)} className="text-[10px]">
                                    {temporalStatusLabel(item.temporalStatus)}
                                  </Badge>
                                </div>
                              </li>
                            ))
                          )}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : sortedDays.length === 0 ? (
            <p className="text-sm text-slate-500">Secili aralikta takvim kaydi bulunmuyor.</p>
          ) : (
            <div className="space-y-4">
              {sortedDays.map((dayKey) => (
                <section key={dayKey} className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">{dayKey}</div>
                  <ul className="divide-y divide-slate-100">
                    {groupedItems[dayKey].map((item) => (
                      <li key={item.id} className="space-y-2 bg-white px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={eventKindVariant(item.eventKind)}>{eventKindLabel(item.eventKind)}</Badge>
                          <Badge variant={temporalStatusVariant(item.temporalStatus)}>{temporalStatusLabel(item.temporalStatus)}</Badge>
                          <Badge variant="outline">{sourceLabel(item.source)}</Badge>
                          <span className="text-xs text-slate-500" suppressHydrationWarning>
                            {formatDateTimeTR(item.when)}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-slate-900">{item.title}</p>
                        <p className="text-xs text-slate-600">
                          {item.caseTitle}
                          {item.caseFileNo ? ` - Dosya No: ${item.caseFileNo}` : ''}
                        </p>
                        {item.description ? <p className="text-sm text-slate-700">{item.description}</p> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
