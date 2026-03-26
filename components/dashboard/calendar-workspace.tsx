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
type CalendarSource = 'task_deadline' | 'timeline_event' | 'limitation_acceptance' | 'holiday';
type TaskStatus = 'open' | 'in_progress' | 'done';
type TaskPriority = 'low' | 'normal' | 'high';
type WorkflowStatus = 'planned' | 'prepared' | 'completed' | 'postponed';
type TaskType =
  | 'follow_up'
  | 'petition_drafting'
  | 'contract_review'
  | 'precedent_research'
  | 'hearing_preparation'
  | 'client_meeting'
  | 'service_tracking'
  | 'uyap_control';
type DeadlineType = 'due_date' | 'objection_deadline' | 'response_deadline' | 'hearing_date' | 'service_control';
type RiskLevel = 'low' | 'medium' | 'critical';
type Confidentiality = 'team' | 'restricted';

type CalendarListItem = {
  id: string;
  sourceId: string;
  source: CalendarSource;
  eventKind: CalendarEventKind;
  temporalStatus: CalendarTemporalStatus;
  when: string;
  title: string;
  description: string | null;
  caseId: string;
  caseTitle: string;
  caseFileNo: string | null;
  priority: TaskPriority | null;
  taskStatus: TaskStatus | null;
  assigneeId: string | null;
  assigneeName: string | null;
  taskType: TaskType | null;
  deadlineType: DeadlineType | null;
  riskLevel: RiskLevel | null;
  confidentiality: Confidentiality | null;
  workflowStatus: WorkflowStatus;
  linkedTaskId: string | null;
  linkedTimelineEventId: string | null;
  syncKind: 'task_deadline' | 'task_pre_reminder' | null;
  canEdit: boolean;
  canDelete: boolean;
};

type CalendarConflictWarning = {
  assigneeId: string;
  assigneeName: string | null;
  scheduledAt: string;
  windowMinutes: number;
  conflictCount: number;
  conflicts: Array<{
    source: 'office_task' | 'timeline_event';
    sourceId: string;
    title: string;
    when: string;
    caseId: string;
    caseTitle: string;
  }>;
};

type CalendarAssignee = {
  id: string;
  fullName: string | null;
  itemCount: number;
};

type CalendarResponse = {
  range: { from: string; to: string };
  summary: { total: number; overdue: number; today: number; upcoming: number };
  cases: CalendarCaseItem[];
  assignees: CalendarAssignee[];
  items: CalendarListItem[];
};

type CalendarHolidayApiResponse = {
  items?: Array<{
    id: string;
    date: string;
    name: string;
  }>;
  error?: string;
};

type CalendarWorkspaceMode = 'full' | 'calendar_only';

type CalendarWorkspaceProps = {
  mode?: CalendarWorkspaceMode;
};

const CALENDAR_SOURCE_ORDER: CalendarSource[] = ['task_deadline', 'timeline_event', 'limitation_acceptance', 'holiday'];

const CALENDAR_SOURCE_LABEL: Record<CalendarSource, string> = {
  task_deadline: 'Gorevler',
  timeline_event: 'Takvim Event',
  limitation_acceptance: 'Sure Kayitlari',
  holiday: 'Resmi Tatiller',
};

const EVENT_KIND_OPTIONS: Array<{ value: CalendarEventKind; label: string }> = [
  { value: 'hearing', label: 'Durusma' },
  { value: 'service', label: 'Tebligat' },
  { value: 'delivery', label: 'Teslim' },
  { value: 'deadline', label: 'Son Gun' },
  { value: 'reminder', label: 'Hatirlatma' },
];

const TASK_TYPE_OPTIONS: Array<{ value: TaskType; label: string }> = [
  { value: 'follow_up', label: 'Takip' },
  { value: 'petition_drafting', label: 'Dilekce Hazirlik' },
  { value: 'contract_review', label: 'Sozlesme Inceleme' },
  { value: 'precedent_research', label: 'Ictihat Arastirma' },
  { value: 'hearing_preparation', label: 'Durusma Hazirlik' },
  { value: 'client_meeting', label: 'Muvekkil Gorusme' },
  { value: 'service_tracking', label: 'Tebligat Takip' },
  { value: 'uyap_control', label: 'UYAP Kontrol' },
];

const DEADLINE_TYPE_OPTIONS: Array<{ value: DeadlineType; label: string }> = [
  { value: 'due_date', label: 'Genel Termin' },
  { value: 'objection_deadline', label: 'Itiraz Suresi' },
  { value: 'response_deadline', label: 'Cevap Suresi' },
  { value: 'hearing_date', label: 'Durusma Tarihi' },
  { value: 'service_control', label: 'Tebligat Kontrol' },
];

const RISK_OPTIONS: Array<{ value: RiskLevel; label: string }> = [
  { value: 'low', label: 'Dusuk' },
  { value: 'medium', label: 'Orta' },
  { value: 'critical', label: 'Kritik' },
];

const CONFIDENTIALITY_OPTIONS: Array<{ value: Confidentiality; label: string }> = [
  { value: 'team', label: 'Ekip' },
  { value: 'restricted', label: 'Sinirli' },
];

const PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: 'low', label: 'Dusuk' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Yuksek' },
];

const TASK_STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'open', label: 'Acik' },
  { value: 'in_progress', label: 'Devam Eden' },
  { value: 'done', label: 'Tamamlandi' },
];

const WORKFLOW_STATUS_OPTIONS: Array<{ value: WorkflowStatus; label: string }> = [
  { value: 'planned', label: 'Planlandi' },
  { value: 'prepared', label: 'Hazirlandi' },
  { value: 'completed', label: 'Tamamlandi' },
  { value: 'postponed', label: 'Ertelendi' },
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

function startOfMonthLocal(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function addMonthsLocal(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
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
  if (source === 'holiday') return 'Resmi Tatil';
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

function resolveTemporalStatusFromIso(isoString: string): CalendarTemporalStatus {
  const when = new Date(isoString);
  if (Number.isNaN(when.getTime())) {
    return 'upcoming';
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  if (when < start) return 'overdue';
  if (when < end) return 'today';
  return 'upcoming';
}

type ImportanceTone = 'high' | 'normal' | 'low' | 'holiday' | 'none';

function resolveImportanceTone(item: CalendarListItem): ImportanceTone {
  if (item.source === 'holiday') {
    return 'holiday';
  }

  if (item.priority === 'high' || item.riskLevel === 'critical') {
    return 'high';
  }

  if (item.priority === 'normal' || item.riskLevel === 'medium') {
    return 'normal';
  }

  if (item.priority === 'low' || item.riskLevel === 'low') {
    return 'low';
  }

  return 'none';
}

function importanceBadgeLabel(tone: ImportanceTone) {
  if (tone === 'high') return 'Onem: Kritik';
  if (tone === 'normal') return 'Onem: Normal';
  if (tone === 'low') return 'Onem: Dusuk';
  if (tone === 'holiday') return 'Resmi Tatil';
  return 'Onem: -';
}

function importanceBadgeVariant(tone: ImportanceTone): 'critical' | 'blue' | 'success' | 'warning' | 'muted' {
  if (tone === 'high') return 'critical';
  if (tone === 'normal') return 'blue';
  if (tone === 'low') return 'success';
  if (tone === 'holiday') return 'warning';
  return 'muted';
}

function importanceCardClass(tone: ImportanceTone) {
  if (tone === 'high') return 'border-l-4 border-l-red-500 bg-red-50/50';
  if (tone === 'normal') return 'border-l-4 border-l-blue-500 bg-blue-50/40';
  if (tone === 'low') return 'border-l-4 border-l-emerald-500 bg-emerald-50/40';
  if (tone === 'holiday') return 'border-l-4 border-l-amber-500 bg-amber-50/60';
  return 'border-l-4 border-l-slate-300 bg-slate-50';
}

function importanceDotClass(tone: ImportanceTone) {
  if (tone === 'high') return 'bg-red-500';
  if (tone === 'normal') return 'bg-blue-500';
  if (tone === 'low') return 'bg-emerald-500';
  if (tone === 'holiday') return 'bg-amber-500';
  return 'bg-slate-400';
}

function sourceVariant(source: CalendarSource): 'blue' | 'orange' | 'success' | 'warning' {
  if (source === 'task_deadline') return 'orange';
  if (source === 'timeline_event') return 'blue';
  if (source === 'limitation_acceptance') return 'success';
  return 'warning';
}

function workflowStatusLabel(status: WorkflowStatus) {
  if (status === 'planned') return 'Planlandi';
  if (status === 'prepared') return 'Hazirlandi';
  if (status === 'completed') return 'Tamamlandi';
  return 'Ertelendi';
}

function workflowStatusVariant(status: WorkflowStatus): 'outline' | 'blue' | 'success' | 'warning' {
  if (status === 'prepared') return 'blue';
  if (status === 'completed') return 'success';
  if (status === 'postponed') return 'warning';
  return 'outline';
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

function formatDayHeaderLabel(date: Date) {
  return date.toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatMonthHeaderLabel(date: Date) {
  return date.toLocaleDateString('tr-TR', {
    month: 'long',
    year: 'numeric',
  });
}

function toMonthInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function monthInputToDateKey(value: string) {
  const [yearRaw, monthRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) {
    return null;
  }

  const date = new Date(year, month - 1, 1, 0, 0, 0, 0);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return toLocalDateKey(date);
}

function taskTypeLabel(value: TaskType | null) {
  if (!value) return '-';
  return TASK_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function deadlineTypeLabel(value: DeadlineType | null) {
  if (!value) return '-';
  return DEADLINE_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function riskLevelLabel(value: RiskLevel | null) {
  if (!value) return '-';
  return RISK_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function confidentialityLabel(value: Confidentiality | null) {
  if (!value) return '-';
  return CONFIDENTIALITY_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function buildGoogleCalendarUrl(item: CalendarListItem) {
  const startDate = new Date(item.when);
  if (Number.isNaN(startDate.getTime())) {
    return null;
  }

  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  const formatDate = (date: Date) => date.toISOString().replace(/-|:|\.\d\d\d/g, '');

  const url = new URL('https://www.google.com/calendar/render');
  url.searchParams.append('action', 'TEMPLATE');
  url.searchParams.append('text', item.title);
  url.searchParams.append('dates', `${formatDate(startDate)}/${formatDate(endDate)}`);
  url.searchParams.append('details', `${item.caseTitle}${item.description ? `\n\n${item.description}` : ''}`);

  return url.toString();
}

function toIsoFromDatetimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function formatConflictWarningText(conflictWarning: CalendarConflictWarning | null | undefined) {
  if (!conflictWarning || conflictWarning.conflictCount <= 0) {
    return null;
  }

  const assigneeLabel = conflictWarning.assigneeName ?? 'atanan kullanici';
  const sample = conflictWarning.conflicts.slice(0, 2).map((item) => `${formatTimeTR(item.when)} ${item.title}`);
  return `${assigneeLabel} icin +/-${conflictWarning.windowMinutes} dakikada ${conflictWarning.conflictCount} cakisma bulundu${
    sample.length > 0 ? ` (${sample.join(', ')})` : ''
  }.`;
}

export function CalendarWorkspace({ mode = 'full' }: CalendarWorkspaceProps) {
  const isCalendarOnly = mode === 'calendar_only';
  const [fromDate, setFromDate] = useState(todayDateOnly());
  const [toDate, setToDate] = useState(plusDaysDateOnly(30));
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month' | 'list'>(isCalendarOnly ? 'month' : 'week');
  const [viewAnchorDate, setViewAnchorDate] = useState(todayDateOnly());

  const [searchText, setSearchText] = useState('');
  const [filterWorkflowStatus, setFilterWorkflowStatus] = useState('');
  const [filterEventType, setFilterEventType] = useState('');
  const [filterAssigneeId, setFilterAssigneeId] = useState('');
  const [filterTaskType, setFilterTaskType] = useState('');
  const [filterDeadlineType, setFilterDeadlineType] = useState('');
  const [filterRiskLevel, setFilterRiskLevel] = useState('');
  const [filterConfidentiality, setFilterConfidentiality] = useState('');

  const [newCaseId, setNewCaseId] = useState('');
  const [newEventKind, setNewEventKind] = useState<CalendarEventKind>('hearing');
  const [newScheduledAt, setNewScheduledAt] = useState(toDateTimeLocal(new Date(Date.now() + 60 * 60 * 1000).toISOString()));
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createTask, setCreateTask] = useState(false);
  const [newPriority, setNewPriority] = useState<TaskPriority>('normal');
  const [newAssignedTo, setNewAssignedTo] = useState('');
  const [newTaskType, setNewTaskType] = useState<TaskType>('follow_up');
  const [newDeadlineType, setNewDeadlineType] = useState<DeadlineType>('due_date');
  const [newRiskLevel, setNewRiskLevel] = useState<RiskLevel>('medium');
  const [newConfidentiality, setNewConfidentiality] = useState<Confidentiality>('team');
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingItem, setEditingItem] = useState<CalendarListItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editWhen, setEditWhen] = useState('');
  const [editEventKind, setEditEventKind] = useState<CalendarEventKind>('reminder');
  const [editPriority, setEditPriority] = useState<TaskPriority>('normal');
  const [editTaskStatus, setEditTaskStatus] = useState<TaskStatus>('open');
  const [editAssignedTo, setEditAssignedTo] = useState('');
  const [editTaskType, setEditTaskType] = useState<TaskType>('follow_up');
  const [editDeadlineType, setEditDeadlineType] = useState<DeadlineType>('due_date');
  const [editRiskLevel, setEditRiskLevel] = useState<RiskLevel>('medium');
  const [editConfidentiality, setEditConfidentiality] = useState<Confidentiality>('team');
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [calendarSourceVisibility, setCalendarSourceVisibility] = useState<Record<CalendarSource, boolean>>({
    task_deadline: true,
    timeline_event: true,
    limitation_acceptance: true,
    holiday: true,
  });
  const [selectedDayKey, setSelectedDayKey] = useState(todayDateOnly());
  const [selectedCalendarItemId, setSelectedCalendarItemId] = useState('');

  const weekStartDate = useMemo(() => startOfWeekMonday(parseDateOnly(viewAnchorDate)), [viewAnchorDate]);
  const weekEndDate = useMemo(() => addDaysLocal(weekStartDate, 6), [weekStartDate]);
  const monthAnchorDate = useMemo(() => parseDateOnly(viewAnchorDate), [viewAnchorDate]);
  const monthStartDate = useMemo(() => startOfMonthLocal(monthAnchorDate), [monthAnchorDate]);
  const monthGridStartDate = useMemo(() => startOfWeekMonday(monthStartDate), [monthStartDate]);
  const monthGridEndDate = useMemo(() => addDaysLocal(monthGridStartDate, 41), [monthGridStartDate]);
  const dayAnchorDate = useMemo(() => parseDateOnly(viewAnchorDate), [viewAnchorDate]);
  const dayAnchorKey = useMemo(() => toLocalDateKey(dayAnchorDate), [dayAnchorDate]);

  const effectiveFrom = useMemo(() => {
    if (viewMode === 'day') {
      return dayAnchorKey;
    }

    if (viewMode === 'week') {
      return toLocalDateKey(weekStartDate);
    }

    if (viewMode === 'month') {
      return toLocalDateKey(monthGridStartDate);
    }

    return fromDate;
  }, [dayAnchorKey, fromDate, monthGridStartDate, viewMode, weekStartDate]);

  const effectiveTo = useMemo(() => {
    if (viewMode === 'day') {
      return dayAnchorKey;
    }

    if (viewMode === 'week') {
      return toLocalDateKey(weekEndDate);
    }

    if (viewMode === 'month') {
      return toLocalDateKey(monthGridEndDate);
    }

    return toDate;
  }, [dayAnchorKey, monthGridEndDate, toDate, viewMode, weekEndDate]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<CalendarResponse, Error>({
    queryKey: [
      'dashboard',
      'calendar',
      selectedCaseId,
      viewMode,
      effectiveFrom,
      effectiveTo,
      searchText,
      filterWorkflowStatus,
      filterEventType,
      filterAssigneeId,
      filterTaskType,
      filterDeadlineType,
      filterRiskLevel,
      filterConfidentiality,
    ],
    queryFn: async () => {
      const search = new URLSearchParams({
        from: effectiveFrom,
        to: effectiveTo,
      });

      if (selectedCaseId) {
        search.set('caseId', selectedCaseId);
      }
      if (searchText.trim()) {
        search.set('q', searchText.trim());
      }
      if (filterWorkflowStatus) {
        search.set('status', filterWorkflowStatus);
      }
      if (filterEventType) {
        search.set('eventType', filterEventType);
      }
      if (filterAssigneeId) {
        search.set('assigneeId', filterAssigneeId);
      }
      if (filterTaskType) {
        search.set('taskType', filterTaskType);
      }
      if (filterDeadlineType) {
        search.set('deadlineType', filterDeadlineType);
      }
      if (filterRiskLevel) {
        search.set('riskLevel', filterRiskLevel);
      }
      if (filterConfidentiality) {
        search.set('confidentiality', filterConfidentiality);
      }

      const [calendarResponse, holidaysResponse] = await Promise.all([
        fetch(`/api/dashboard/calendar?${search.toString()}`, {
          cache: 'no-store',
        }),
        fetch(`/api/dashboard/calendar/holidays?from=${encodeURIComponent(effectiveFrom)}&to=${encodeURIComponent(effectiveTo)}`, {
          cache: 'no-store',
        }),
      ]);

      const payload = (await calendarResponse.json()) as CalendarResponse & { error?: string };
      if (!calendarResponse.ok) {
        throw new Error(payload.error ?? 'Takvim verisi alinamadi.');
      }

      let holidayItems: CalendarListItem[] = [];
      if (holidaysResponse.ok) {
        const holidaysPayload = (await holidaysResponse.json()) as CalendarHolidayApiResponse;
        holidayItems = (holidaysPayload.items ?? []).map((holiday) => {
          const when = `${holiday.date}T09:00:00+03:00`;
          const whenIso = new Date(when).toISOString();
          return {
            id: holiday.id,
            sourceId: holiday.id,
            source: 'holiday',
            eventKind: 'reminder',
            temporalStatus: resolveTemporalStatusFromIso(whenIso),
            when: whenIso,
            title: holiday.name,
            description: 'Resmi tatil',
            caseId: '',
            caseTitle: 'Resmi Tatil',
            caseFileNo: null,
            priority: null,
            taskStatus: null,
            assigneeId: null,
            assigneeName: null,
            taskType: null,
            deadlineType: null,
            riskLevel: null,
            confidentiality: null,
            workflowStatus: 'planned',
            linkedTaskId: null,
            linkedTimelineEventId: null,
            syncKind: null,
            canEdit: false,
            canDelete: false,
          };
        });
      }

      const mergedItems = [...payload.items, ...holidayItems].sort((left, right) => left.when.localeCompare(right.when));
      return {
        ...payload,
        summary: {
          total: mergedItems.length,
          overdue: mergedItems.filter((item) => item.temporalStatus === 'overdue').length,
          today: mergedItems.filter((item) => item.temporalStatus === 'today').length,
          upcoming: mergedItems.filter((item) => item.temporalStatus === 'upcoming').length,
        },
        items: mergedItems,
      };
    },
  });

  const items = data?.items ?? [];
  const cases = data?.cases ?? [];
  const assignees = data?.assignees ?? [];
  const summary = data?.summary ?? { total: 0, overdue: 0, today: 0, upcoming: 0 };
  const visibleCalendarItems = useMemo(() => {
    if (!isCalendarOnly) {
      return items;
    }

    return items.filter((item) => calendarSourceVisibility[item.source]);
  }, [calendarSourceVisibility, isCalendarOnly, items]);
  const holidayItems = useMemo(
    () =>
      items
        .filter((item) => item.source === 'holiday')
        .sort((left, right) => left.when.localeCompare(right.when)),
    [items],
  );

  useEffect(() => {
    if (isCalendarOnly && viewMode === 'list') {
      setViewMode('month');
    }
  }, [isCalendarOnly, viewMode]);

  useEffect(() => {
    if (newCaseId) {
      return;
    }

    if (cases.length > 0) {
      setNewCaseId(cases[0].id);
    }
  }, [cases, newCaseId]);

  const groupedItems = useMemo(() => {
    return visibleCalendarItems.reduce<Record<string, CalendarListItem[]>>((acc, item) => {
      const key = toLocalDateKeyFromIso(item.when);
      if (!key) {
        return acc;
      }

      const current = acc[key] ?? [];
      current.push(item);
      acc[key] = current;
      return acc;
    }, {});
  }, [visibleCalendarItems]);

  const sortedDays = useMemo(() => Object.keys(groupedItems).sort(), [groupedItems]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDaysLocal(weekStartDate, index)), [weekStartDate]);
  const weekItemsByDay = useMemo(() => {
    const map = new Map<string, CalendarListItem[]>();
    visibleCalendarItems.forEach((item) => {
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
  }, [visibleCalendarItems]);

  const dayItems = useMemo(() => weekItemsByDay.get(dayAnchorKey) ?? [], [dayAnchorKey, weekItemsByDay]);
  const selectedDayItems = useMemo(() => weekItemsByDay.get(selectedDayKey) ?? [], [selectedDayKey, weekItemsByDay]);
  const selectedCalendarItem = useMemo(
    () => visibleCalendarItems.find((item) => item.id === selectedCalendarItemId) ?? null,
    [selectedCalendarItemId, visibleCalendarItems],
  );

  useEffect(() => {
    if (selectedDayKey < effectiveFrom || selectedDayKey > effectiveTo) {
      setSelectedDayKey(dayAnchorKey);
    }
  }, [dayAnchorKey, effectiveFrom, effectiveTo, selectedDayKey]);

  useEffect(() => {
    if (selectedDayItems.length === 0) {
      setSelectedCalendarItemId('');
      return;
    }

    const stillExists = selectedDayItems.some((item) => item.id === selectedCalendarItemId);
    if (!stillExists) {
      setSelectedCalendarItemId(selectedDayItems[0].id);
    }
  }, [selectedCalendarItemId, selectedDayItems]);

  const dayHourGroups = useMemo(() => {
    const groups = new Map<number, CalendarListItem[]>();
    dayItems.forEach((item) => {
      const date = new Date(item.when);
      if (Number.isNaN(date.getTime())) {
        return;
      }

      const hour = date.getHours();
      const current = groups.get(hour) ?? [];
      current.push(item);
      groups.set(hour, current);
    });

    return [...groups.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([hour, hourItems]) => ({
        hour,
        items: [...hourItems].sort((left, right) => left.when.localeCompare(right.when)),
      }));
  }, [dayItems]);

  const monthGridDays = useMemo(
    () => Array.from({ length: 42 }, (_, index) => addDaysLocal(monthGridStartDate, index)),
    [monthGridStartDate],
  );
  const sourceCounts = useMemo(() => {
    return CALENDAR_SOURCE_ORDER.reduce<Record<CalendarSource, number>>((acc, source) => {
      acc[source] = items.filter((item) => item.source === source).length;
      return acc;
    }, {} as Record<CalendarSource, number>);
  }, [items]);
  const selectedDayDate = useMemo(() => parseDateOnly(selectedDayKey), [selectedDayKey]);
  const selectedDayLabel = useMemo(() => formatDayHeaderLabel(selectedDayDate), [selectedDayDate]);
  const upcomingItems = useMemo(() => {
    const now = new Date().toISOString();
    return visibleCalendarItems.filter((item) => item.when >= now).slice(0, 8);
  }, [visibleCalendarItems]);
  const upcomingHolidayItems = useMemo(() => {
    const now = new Date().toISOString();
    return holidayItems.filter((item) => item.when >= now).slice(0, 5);
  }, [holidayItems]);

  function selectDay(dayKey: string, opts?: { anchor?: boolean }) {
    setSelectedDayKey(dayKey);
    if (opts?.anchor) {
      setViewAnchorDate(dayKey);
    }
  }

  function selectCalendarItem(item: CalendarListItem) {
    setSelectedCalendarItemId(item.id);
    const dayKey = toLocalDateKeyFromIso(item.when);
    if (dayKey) {
      setSelectedDayKey(dayKey);
      setViewAnchorDate(dayKey);
    }
  }

  function jumpToToday() {
    if (viewMode === 'list') {
      setFromDate(todayDateOnly());
      setToDate(plusDaysDateOnly(30));
      return;
    }

    const today = todayDateOnly();
    setViewAnchorDate(today);
    setSelectedDayKey(today);
  }

  function movePeriod(step: -1 | 1) {
    if (viewMode === 'list') {
      const from = parseDateOnly(fromDate);
      const to = parseDateOnly(toDate);
      const rangeDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1);
      setFromDate(toLocalDateKey(addDaysLocal(from, step * rangeDays)));
      setToDate(toLocalDateKey(addDaysLocal(to, step * rangeDays)));
      return;
    }

    const anchor = parseDateOnly(viewAnchorDate);
    if (viewMode === 'day') {
      setViewAnchorDate(toLocalDateKey(addDaysLocal(anchor, step)));
      return;
    }

    if (viewMode === 'week') {
      setViewAnchorDate(toLocalDateKey(addDaysLocal(anchor, step * 7)));
      return;
    }

    setViewAnchorDate(toLocalDateKey(addMonthsLocal(anchor, step)));
  }

  const periodLabel = useMemo(() => {
    if (viewMode === 'day') {
      return formatDayHeaderLabel(dayAnchorDate);
    }

    if (viewMode === 'week') {
      return formatWeekRangeLabel(weekStartDate, weekEndDate);
    }

    if (viewMode === 'month') {
      return formatMonthHeaderLabel(monthStartDate);
    }

    return `${fromDate} - ${toDate}`;
  }, [dayAnchorDate, fromDate, monthStartDate, toDate, viewMode, weekEndDate, weekStartDate]);

  function startEditing(item: CalendarListItem) {
    setEditingItem(item);
    setEditTitle(item.title);
    setEditDescription(item.description ?? '');
    setEditWhen(toDateTimeLocal(item.when));
    setEditEventKind(item.eventKind);
    setEditPriority(item.priority ?? 'normal');
    setEditTaskStatus(item.taskStatus ?? 'open');
    setEditAssignedTo(item.assigneeId ?? '');
    setEditTaskType(item.taskType ?? 'follow_up');
    setEditDeadlineType(item.deadlineType ?? 'due_date');
    setEditRiskLevel(item.riskLevel ?? 'medium');
    setEditConfidentiality(item.confidentiality ?? 'team');
    setEditMessage(null);
  }

  function cancelEditing() {
    setEditingItem(null);
    setEditMessage(null);
  }

  async function updateCalendarItem() {
    if (!editingItem) {
      return;
    }

    if (editTitle.trim().length < 3) {
      setEditMessage('Baslik en az 3 karakter olmali.');
      return;
    }

    const scheduledAtIso = toIsoFromDatetimeLocal(editWhen);
    if (!scheduledAtIso) {
      setEditMessage('Tarih formati gecersiz.');
      return;
    }

    setIsEditing(true);
    setEditMessage(null);

    try {
      const body: Record<string, unknown> = {
        source: editingItem.source,
        itemId: editingItem.sourceId,
        caseId: editingItem.caseId,
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        scheduledAt: scheduledAtIso,
      };

      if (editingItem.source === 'timeline_event') {
        body.eventKind = editEventKind;
      }

      if (editingItem.source === 'task_deadline') {
        body.priority = editPriority;
        body.status = editTaskStatus;
        body.assignedTo = editAssignedTo || null;
        body.taskType = editTaskType;
        body.deadlineType = editDeadlineType;
        body.riskLevel = editRiskLevel;
        body.confidentiality = editConfidentiality;
      }

      const response = await fetch('/api/dashboard/calendar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as { error?: string; conflictWarning?: CalendarConflictWarning | null };
      if (!response.ok) {
        setEditMessage(payload.error ?? 'Takvim kaydi guncellenemedi.');
        return;
      }

      const conflictText = formatConflictWarningText(payload.conflictWarning);
      setFormMessage(conflictText ? `Takvim kaydi guncellendi. ${conflictText}` : 'Takvim kaydi guncellendi.');
      await refetch();
      cancelEditing();
    } catch {
      setEditMessage('Takvim kaydi guncellenirken ag hatasi olustu.');
    } finally {
      setIsEditing(false);
    }
  }

  async function removeCalendarItem() {
    if (!editingItem) {
      return;
    }

    setIsRemoving(true);
    setEditMessage(null);

    try {
      const response = await fetch('/api/dashboard/calendar', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: editingItem.source,
          itemId: editingItem.sourceId,
          caseId: editingItem.caseId,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setEditMessage(payload.error ?? 'Takvim kaydi silinemedi.');
        return;
      }

      setEditMessage(editingItem.source === 'task_deadline' ? 'Gorev takvimden kaldirildi.' : 'Takvim kaydi silindi.');
      await refetch();
      cancelEditing();
    } catch {
      setEditMessage('Kayit silme sirasinda ag hatasi olustu.');
    } finally {
      setIsRemoving(false);
    }
  }

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

    const scheduledAtIso = toIsoFromDatetimeLocal(newScheduledAt);
    if (!scheduledAtIso) {
      setFormMessage('Tarih formati gecersiz.');
      return;
    }

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
          createTask,
          priority: createTask ? newPriority : undefined,
          assignedTo: createTask ? newAssignedTo || undefined : undefined,
          taskType: createTask ? newTaskType : undefined,
          deadlineType: createTask ? newDeadlineType : undefined,
          riskLevel: createTask ? newRiskLevel : undefined,
          confidentiality: createTask ? newConfidentiality : undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string; conflictWarning?: CalendarConflictWarning | null };
      if (!response.ok) {
        setFormMessage(payload.error ?? 'Takvim event olusturulamadi.');
        return;
      }

      const successText = createTask ? 'Takvim kaydi ve bagli gorev eklendi.' : 'Takvim event eklendi.';
      const conflictText = formatConflictWarningText(payload.conflictWarning);
      setFormMessage(conflictText ? `${successText} ${conflictText}` : successText);
      setNewTitle('');
      setNewDescription('');
      setNewEventKind('hearing');
      setNewScheduledAt(toDateTimeLocal(new Date(Date.now() + 60 * 60 * 1000).toISOString()));
      setCreateTask(false);
      await refetch();
    } catch {
      setFormMessage('Takvim event kaydi sirasinda ag hatasi olustu.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {!isCalendarOnly ? (
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Takvim</CardTitle>
                <CardDescription>Gun/hafta/ay/liste gorunumu ile dosya, gorev ve event akislarini birlikte yonet.</CardDescription>
              </div>
              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('day')}
                  className={
                    viewMode === 'day'
                      ? 'rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white'
                      : 'rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100'
                  }
                >
                  Gun
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
                <button
                  type="button"
                  onClick={() => setViewMode('month')}
                  className={
                    viewMode === 'month'
                      ? 'rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white'
                      : 'rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100'
                  }
                >
                  Aylik
                </button>
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
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 xl:grid-cols-[1fr_220px]">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium text-slate-500">Donem</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => movePeriod(-1)}>
                    Onceki
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={jumpToToday}>
                    Bugun
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => movePeriod(1)}>
                    Sonraki
                  </Button>
                  <span className="ml-auto text-sm font-medium text-slate-700">{periodLabel}</span>
                </div>
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

            {viewMode === 'list' ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Baslangic</label>
                  <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="h-11" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Bitis</label>
                  <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="h-11" />
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Arama</label>
                <Input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Baslik, dosya, sorumlu..."
                  className="h-11"
                />
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
              <div>
                <label className="mb-1 block text-xs text-slate-500">Durum</label>
                <select
                  value={filterWorkflowStatus}
                  onChange={(event) => setFilterWorkflowStatus(event.target.value)}
                  className={SELECT_CLASS_NAME}
                >
                  <option value="">Tum durumlar</option>
                  {WORKFLOW_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Event Turu</label>
                <select value={filterEventType} onChange={(event) => setFilterEventType(event.target.value)} className={SELECT_CLASS_NAME}>
                  <option value="">Tum event turleri</option>
                  {EVENT_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Sorumlu</label>
                <select value={filterAssigneeId} onChange={(event) => setFilterAssigneeId(event.target.value)} className={SELECT_CLASS_NAME}>
                  <option value="">Tum sorumlular</option>
                  {assignees.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fullName ?? item.id} ({item.itemCount})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Gorev Tipi</label>
                <select value={filterTaskType} onChange={(event) => setFilterTaskType(event.target.value)} className={SELECT_CLASS_NAME}>
                  <option value="">Tum gorev tipleri</option>
                  {TASK_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Sure Tipi</label>
                <select
                  value={filterDeadlineType}
                  onChange={(event) => setFilterDeadlineType(event.target.value)}
                  className={SELECT_CLASS_NAME}
                >
                  <option value="">Tum sure tipleri</option>
                  {DEADLINE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Risk</label>
                <select value={filterRiskLevel} onChange={(event) => setFilterRiskLevel(event.target.value)} className={SELECT_CLASS_NAME}>
                  <option value="">Tum risk seviyeleri</option>
                  {RISK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Gizlilik</label>
                <select
                  value={filterConfidentiality}
                  onChange={(event) => setFilterConfidentiality(event.target.value)}
                  className={SELECT_CLASS_NAME}
                >
                  <option value="">Tum seviyeler</option>
                  {CONFIDENTIALITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => {
                  setSearchText('');
                  setFilterWorkflowStatus('');
                  setFilterEventType('');
                  setFilterAssigneeId('');
                  setFilterTaskType('');
                  setFilterDeadlineType('');
                  setFilterRiskLevel('');
                  setFilterConfidentiality('');
                }}
              >
                Filtreleri Temizle
              </Button>
            </div>

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
      ) : null}

      {isCalendarOnly ? (
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <div className="bg-[radial-gradient(circle_at_top_right,#dbeafe_0%,#0f172a_55%,#0b1120_100%)] px-4 py-4 text-white sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-blue-100">Takvim</p>
                <h2 className="mt-1 text-xl font-semibold">{periodLabel}</h2>
                <p className="mt-1 text-sm text-blue-100">Gorevler, timeline eventleri ve resmi tatiller ayni akis uzerinde.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs sm:min-w-[220px]">
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">
                  <p className="text-blue-100">Toplam Kayit</p>
                  <p className="text-lg font-semibold text-white">{summary.total}</p>
                </div>
                <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">
                  <p className="text-blue-100">Resmi Tatil</p>
                  <p className="text-lg font-semibold text-white">{holidayItems.length}</p>
                </div>
              </div>
            </div>
          </div>
          <CardContent className="space-y-3 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('day')}
                  className={
                    viewMode === 'day'
                      ? 'rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white'
                      : 'rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100'
                  }
                >
                  Gun
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
                <button
                  type="button"
                  onClick={() => setViewMode('month')}
                  className={
                    viewMode === 'month'
                      ? 'rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white'
                      : 'rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100'
                  }
                >
                  Aylik
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => movePeriod(-1)}>
                  Onceki
                </Button>
                <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={jumpToToday}>
                  Bugun
                </Button>
                <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => movePeriod(1)}>
                  Sonraki
                </Button>
                <Input
                  type="month"
                  value={toMonthInputValue(monthStartDate)}
                  onChange={(event) => {
                    const next = monthInputToDateKey(event.target.value);
                    if (next) {
                      setViewAnchorDate(next);
                      setSelectedDayKey(next);
                      setViewMode('month');
                    }
                  }}
                  className="h-9 w-[170px]"
                />
                <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => refetch()} disabled={isFetching}>
                  {isFetching ? 'Yenileniyor...' : 'Yenile'}
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Arama</label>
                <Input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Baslik, dosya, sorumlu..."
                  className="h-10"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Dosya</label>
                <select value={selectedCaseId} onChange={(event) => setSelectedCaseId(event.target.value)} className={SELECT_CLASS_NAME}>
                  <option value="">Tum dosyalar</option>
                  {cases.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Sorumlu</label>
                <select value={filterAssigneeId} onChange={(event) => setFilterAssigneeId(event.target.value)} className={SELECT_CLASS_NAME}>
                  <option value="">Tum sorumlular</option>
                  {assignees.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fullName ?? item.id} ({item.itemCount})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="critical">Kritik</Badge>
              <Badge variant="blue">Normal</Badge>
              <Badge variant="success">Dusuk</Badge>
              <Badge variant="warning">Resmi Tatil</Badge>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!isCalendarOnly ? (
        <Card>
          <CardHeader>
            <CardTitle>Sorumlu Is Yuku</CardTitle>
            <CardDescription>Secili tarih araligindaki sorumlu bazli gorev dagilimi.</CardDescription>
          </CardHeader>
          <CardContent>
            {assignees.length === 0 ? (
              <p className="text-sm text-slate-500">Sorumlu dagilimi icin kayit bulunamadi.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {assignees.map((item) => {
                  const isSelected = filterAssigneeId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFilterAssigneeId(isSelected ? '' : item.id)}
                      className={
                        isSelected
                          ? 'rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-left'
                          : 'rounded-xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-slate-300'
                      }
                    >
                      <p className="text-xs text-slate-500">Sorumlu</p>
                      <p className="mt-1 text-sm font-medium text-slate-900">{item.fullName ?? item.id}</p>
                      <p className="mt-2 text-lg font-semibold text-slate-900">{item.itemCount} kayit</p>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!isCalendarOnly ? (
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

          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={createTask}
              onChange={(event) => setCreateTask(event.target.checked)}
              className="h-4 w-4"
            />
            Bu kaydi gorev olarak da olustur (task + otomatik hatirlatma zinciri)
          </label>

          {createTask ? (
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Oncelik</label>
                <select value={newPriority} onChange={(event) => setNewPriority(event.target.value as TaskPriority)} className={SELECT_CLASS_NAME}>
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Sorumlu</label>
                <select value={newAssignedTo} onChange={(event) => setNewAssignedTo(event.target.value)} className={SELECT_CLASS_NAME}>
                  <option value="">Ben / Varsayilan</option>
                  {assignees.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.fullName ?? item.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Gorev Tipi</label>
                <select value={newTaskType} onChange={(event) => setNewTaskType(event.target.value as TaskType)} className={SELECT_CLASS_NAME}>
                  {TASK_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Sure Tipi</label>
                <select
                  value={newDeadlineType}
                  onChange={(event) => setNewDeadlineType(event.target.value as DeadlineType)}
                  className={SELECT_CLASS_NAME}
                >
                  {DEADLINE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Risk</label>
                <select value={newRiskLevel} onChange={(event) => setNewRiskLevel(event.target.value as RiskLevel)} className={SELECT_CLASS_NAME}>
                  {RISK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Gizlilik</label>
                <select
                  value={newConfidentiality}
                  onChange={(event) => setNewConfidentiality(event.target.value as Confidentiality)}
                  className={SELECT_CLASS_NAME}
                >
                  {CONFIDENTIALITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          {formMessage ? <p className="text-xs text-slate-600">{formMessage}</p> : null}

          <div className="flex justify-end">
            <Button type="button" onClick={createCalendarEvent} disabled={isSubmitting} className="rounded-xl px-6" size="sm">
              {isSubmitting ? 'Kaydediliyor...' : 'Event Ekle'}
            </Button>
          </div>
          </CardContent>
        </Card>
      ) : null}

      {!isCalendarOnly && editingItem ? (
        <Card>
          <CardHeader>
            <CardTitle>Kayit Duzenle</CardTitle>
            <CardDescription>
              {editingItem.source === 'task_deadline'
                ? 'Gorev takvim kaydini ve bagli otomatik hatirlatmalari gunceller.'
                : 'Manuel takvim event kaydini gunceller.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Baslik</label>
                <Input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className="h-11" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Tarih-Saat</label>
                <Input type="datetime-local" value={editWhen} onChange={(event) => setEditWhen(event.target.value)} className="h-11" />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">Aciklama</label>
              <Textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} className="min-h-[84px]" />
            </div>

            {editingItem.source === 'timeline_event' ? (
              <div>
                <label className="mb-1 block text-xs text-slate-500">Event Turu</label>
                <select
                  value={editEventKind}
                  onChange={(event) => setEditEventKind(event.target.value as CalendarEventKind)}
                  className={SELECT_CLASS_NAME}
                >
                  {EVENT_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {editingItem.source === 'task_deadline' ? (
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Oncelik</label>
                  <select
                    value={editPriority}
                    onChange={(event) => setEditPriority(event.target.value as TaskPriority)}
                    className={SELECT_CLASS_NAME}
                  >
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Durum</label>
                  <select
                    value={editTaskStatus}
                    onChange={(event) => setEditTaskStatus(event.target.value as TaskStatus)}
                    className={SELECT_CLASS_NAME}
                  >
                    {TASK_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Sorumlu</label>
                  <select value={editAssignedTo} onChange={(event) => setEditAssignedTo(event.target.value)} className={SELECT_CLASS_NAME}>
                    <option value="">Bos / Atanmamis</option>
                    {assignees.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.fullName ?? item.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Gorev Tipi</label>
                  <select value={editTaskType} onChange={(event) => setEditTaskType(event.target.value as TaskType)} className={SELECT_CLASS_NAME}>
                    {TASK_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Sure Tipi</label>
                  <select
                    value={editDeadlineType}
                    onChange={(event) => setEditDeadlineType(event.target.value as DeadlineType)}
                    className={SELECT_CLASS_NAME}
                  >
                    {DEADLINE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Risk</label>
                  <select value={editRiskLevel} onChange={(event) => setEditRiskLevel(event.target.value as RiskLevel)} className={SELECT_CLASS_NAME}>
                    {RISK_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Gizlilik</label>
                  <select
                    value={editConfidentiality}
                    onChange={(event) => setEditConfidentiality(event.target.value as Confidentiality)}
                    className={SELECT_CLASS_NAME}
                  >
                    {CONFIDENTIALITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            {editMessage ? <p className="text-xs text-slate-600">{editMessage}</p> : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={cancelEditing} size="sm" className="rounded-lg">
                Iptal
              </Button>
              <Button type="button" variant="outline" onClick={updateCalendarItem} disabled={isEditing} size="sm" className="rounded-lg">
                {isEditing ? 'Kaydediliyor...' : 'Kaydi Guncelle'}
              </Button>
              {editingItem.canDelete ? (
                <Button type="button" variant="destructive" onClick={removeCalendarItem} disabled={isRemoving} size="sm" className="rounded-lg">
                  {isRemoving
                    ? 'Isleniyor...'
                    : editingItem.source === 'task_deadline'
                      ? 'Takvimden Kaldir'
                      : 'Sil'}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Takvim Akisi</CardTitle>
          <CardDescription>
            {viewMode === 'day'
              ? 'Gunluk saat gruplu gorunum'
              : viewMode === 'week'
                ? 'Haftalik takvim gorunumu'
                : viewMode === 'month'
                  ? 'Aylik takvim gorunumu'
                  : 'Tarih sirali event listesi'}
          </CardDescription>
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
          ) : isCalendarOnly ? (
            <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
              <aside className="space-y-3">
                <section className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-700">{formatMonthHeaderLabel(monthStartDate)}</p>
                    <span className="text-xs text-slate-500">{visibleCalendarItems.length} kayit</span>
                  </div>
                  <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-slate-400">
                    {['P', 'S', 'C', 'P', 'C', 'C', 'P'].map((label, index) => (
                      <span key={`${label}-${index}`}>{label}</span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {monthGridDays.map((day) => {
                      const dayKey = toLocalDateKey(day);
                      const dayItems = weekItemsByDay.get(dayKey) ?? [];
                      const inCurrentMonth = day.getMonth() === monthStartDate.getMonth();
                      const isSelected = dayKey === selectedDayKey;
                      const isToday = dayKey === todayDateOnly();
                      return (
                        <button
                          key={`mini-${dayKey}`}
                          type="button"
                          onClick={() => selectDay(dayKey, { anchor: true })}
                          className={
                            isSelected
                              ? 'flex h-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-semibold text-white'
                              : inCurrentMonth
                                ? 'relative flex h-8 items-center justify-center rounded-lg text-xs text-slate-700 hover:bg-slate-100'
                                : 'relative flex h-8 items-center justify-center rounded-lg text-xs text-slate-400 hover:bg-slate-100'
                          }
                        >
                          {day.getDate()}
                          {isToday && !isSelected ? (
                            <span className="absolute inset-0 rounded-lg border border-blue-400/80" aria-hidden="true" />
                          ) : null}
                          {dayItems.length > 0 ? (
                            <span
                              className={
                                isSelected
                                  ? 'absolute bottom-0.5 h-1.5 w-1.5 rounded-full bg-white'
                                  : 'absolute bottom-0.5 h-1.5 w-1.5 rounded-full bg-slate-400'
                              }
                              aria-hidden="true"
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kaynaklar</p>
                  <div className="mt-2 space-y-2">
                    {CALENDAR_SOURCE_ORDER.map((source) => {
                      const active = calendarSourceVisibility[source];
                      return (
                        <button
                          key={source}
                          type="button"
                          onClick={() =>
                            setCalendarSourceVisibility((prev) => ({
                              ...prev,
                              [source]: !prev[source],
                            }))
                          }
                          className={
                            active
                              ? 'flex w-full items-center justify-between rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-left'
                              : 'flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-left opacity-70'
                          }
                        >
                          <div className="flex items-center gap-2">
                            <span className={active ? 'h-2.5 w-2.5 rounded-full bg-slate-900' : 'h-2.5 w-2.5 rounded-full bg-slate-300'} />
                            <span className="text-xs font-medium text-slate-700">{CALENDAR_SOURCE_LABEL[source]}</span>
                          </div>
                          <Badge variant={sourceVariant(source)}>{sourceCounts[source] ?? 0}</Badge>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Durum Ozeti</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-red-50 px-2 py-2">
                      <p className="text-[10px] text-red-700">Gecmis</p>
                      <p className="text-sm font-semibold text-red-700">{summary.overdue}</p>
                    </div>
                    <div className="rounded-lg bg-amber-50 px-2 py-2">
                      <p className="text-[10px] text-amber-700">Bugun</p>
                      <p className="text-sm font-semibold text-amber-700">{summary.today}</p>
                    </div>
                    <div className="rounded-lg bg-emerald-50 px-2 py-2">
                      <p className="text-[10px] text-emerald-700">Yaklasan</p>
                      <p className="text-sm font-semibold text-emerald-700">{summary.upcoming}</p>
                    </div>
                    <div className="rounded-lg bg-blue-50 px-2 py-2">
                      <p className="text-[10px] text-blue-700">Secili Gun</p>
                      <p className="text-sm font-semibold text-blue-700">{selectedDayItems.length}</p>
                    </div>
                  </div>
                </section>
              </aside>

              <section className="rounded-2xl border border-slate-200 bg-white p-3">
                {viewMode === 'day' ? (
                  dayHourGroups.length === 0 ? (
                    <p className="text-sm text-slate-500">Secili gun icin takvim kaydi bulunmuyor.</p>
                  ) : (
                    <div className="space-y-3">
                      {dayHourGroups.map((group) => (
                        <section key={`calendar-only-day-${group.hour}`} className="rounded-xl border border-slate-200 bg-white">
                          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                            {String(group.hour).padStart(2, '0')}:00
                          </div>
                          <ul className="space-y-2 p-3">
                            {group.items.map((item) => {
                              const importanceTone = resolveImportanceTone(item);
                              const isSelected = selectedCalendarItemId === item.id;
                              return (
                                <li key={`calendar-only-day-item-${item.id}`}>
                                  <button
                                    type="button"
                                    onClick={() => selectCalendarItem(item)}
                                    className={
                                      isSelected
                                        ? `w-full rounded-lg border border-slate-900 px-3 py-2 text-left shadow-sm ${importanceCardClass(importanceTone)}`
                                        : `w-full rounded-lg border border-slate-200 px-3 py-2 text-left ${importanceCardClass(importanceTone)}`
                                    }
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge variant={eventKindVariant(item.eventKind)}>{eventKindLabel(item.eventKind)}</Badge>
                                      <Badge variant={importanceBadgeVariant(importanceTone)}>{importanceBadgeLabel(importanceTone)}</Badge>
                                      <Badge variant={sourceVariant(item.source)}>{sourceLabel(item.source)}</Badge>
                                      <span className="text-xs text-slate-500">{formatTimeTR(item.when)}</span>
                                    </div>
                                    <p className="mt-1 text-sm font-medium text-slate-900">{item.title}</p>
                                    <p className="text-xs text-slate-600">
                                      {item.caseTitle}
                                      {item.caseFileNo ? ` - Dosya No: ${item.caseFileNo}` : ''}
                                    </p>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      ))}
                    </div>
                  )
                ) : viewMode === 'week' ? (
                  <div className="space-y-3">
                    <div className="overflow-x-auto">
                      <div className="grid min-w-[820px] grid-cols-7 gap-2">
                        {weekDays.map((day) => {
                          const dayKey = toLocalDateKey(day);
                          const dayItems = weekItemsByDay.get(dayKey) ?? [];
                          const isSelectedDay = dayKey === selectedDayKey;
                          return (
                            <section
                              key={`calendar-only-week-${dayKey}`}
                              className={isSelectedDay ? 'rounded-xl border border-slate-900 bg-white' : 'rounded-xl border border-slate-200 bg-white'}
                            >
                              <button
                                type="button"
                                onClick={() => selectDay(dayKey, { anchor: true })}
                                className={
                                  isSelectedDay
                                    ? 'w-full border-b border-slate-200 bg-slate-900 px-3 py-2 text-left text-white'
                                    : 'w-full border-b border-slate-200 bg-slate-50 px-3 py-2 text-left'
                                }
                              >
                                <p className={isSelectedDay ? 'text-xs font-semibold uppercase tracking-wide text-slate-100' : 'text-xs font-semibold uppercase tracking-wide text-slate-500'}>
                                  {formatWeekDayHeader(day)}
                                </p>
                                <p className={isSelectedDay ? 'text-xs text-slate-100' : 'text-xs text-slate-600'}>{dayItems.length} kayit</p>
                              </button>
                              <ul className="max-h-[420px] space-y-2 overflow-y-auto p-2">
                                {dayItems.length === 0 ? (
                                  <li className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-400">
                                    Kayit yok
                                  </li>
                                ) : (
                                  dayItems.map((item) => {
                                    const importanceTone = resolveImportanceTone(item);
                                    const isSelected = selectedCalendarItemId === item.id;
                                    return (
                                      <li key={`calendar-only-week-item-${item.id}`}>
                                        <button
                                          type="button"
                                          onClick={() => selectCalendarItem(item)}
                                          className={
                                            isSelected
                                              ? `w-full rounded-lg border border-slate-900 px-2 py-2 text-left shadow-sm ${importanceCardClass(importanceTone)}`
                                              : `w-full rounded-lg border border-slate-200 px-2 py-2 text-left ${importanceCardClass(importanceTone)}`
                                          }
                                        >
                                          <p className="text-[11px] font-semibold text-slate-500">{formatTimeTR(item.when)}</p>
                                          <p className="mt-1 break-words text-xs font-medium text-slate-800">{item.title}</p>
                                          <Badge variant={sourceVariant(item.source)} className="mt-1 text-[10px]">
                                            {sourceLabel(item.source)}
                                          </Badge>
                                        </button>
                                      </li>
                                    );
                                  })
                                )}
                              </ul>
                            </section>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-7 gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {['Pzt', 'Sal', 'Car', 'Per', 'Cum', 'Cts', 'Paz'].map((label) => (
                        <div key={`calendar-only-month-label-${label}`} className="rounded-lg bg-slate-50 px-2 py-1 text-center">
                          {label}
                        </div>
                      ))}
                    </div>
                    <div className="overflow-x-auto">
                      <div className="grid min-w-[900px] grid-cols-7 gap-2">
                        {monthGridDays.map((day) => {
                          const dayKey = toLocalDateKey(day);
                          const dayItems = weekItemsByDay.get(dayKey) ?? [];
                          const inCurrentMonth = day.getMonth() === monthStartDate.getMonth();
                          const isSelectedDay = dayKey === selectedDayKey;
                          const isToday = dayKey === todayDateOnly();
                          return (
                            <section
                              key={`calendar-only-month-${dayKey}`}
                              className={
                                isSelectedDay
                                  ? 'min-h-[150px] rounded-xl border border-slate-900 bg-white p-2 shadow-sm'
                                  : inCurrentMonth
                                    ? 'min-h-[150px] rounded-xl border border-slate-200 bg-white p-2'
                                    : 'min-h-[150px] rounded-xl border border-slate-100 bg-slate-50/80 p-2'
                              }
                            >
                              <button
                                type="button"
                                onClick={() => selectDay(dayKey, { anchor: true })}
                                className="mb-2 flex w-full items-center justify-between rounded-md px-1 py-0.5 hover:bg-slate-100"
                              >
                                <span
                                  className={
                                    isSelectedDay
                                      ? 'text-xs font-semibold text-slate-900'
                                      : inCurrentMonth
                                        ? 'text-xs font-semibold text-slate-700'
                                        : 'text-xs font-semibold text-slate-400'
                                  }
                                >
                                  {day.toLocaleDateString('tr-TR', { day: '2-digit' })}
                                </span>
                                <span className="flex items-center gap-1">
                                  {isToday ? <span className="h-2 w-2 rounded-full bg-blue-500" /> : null}
                                  {dayItems.length > 0 ? <span className="text-[10px] text-slate-500">{dayItems.length}</span> : null}
                                </span>
                              </button>
                              <ul className="space-y-1">
                                {dayItems.slice(0, 4).map((item) => {
                                  const importanceTone = resolveImportanceTone(item);
                                  const isSelectedItem = selectedCalendarItemId === item.id;
                                  return (
                                    <li key={`calendar-only-month-item-${item.id}`}>
                                      <button
                                        type="button"
                                        onClick={() => selectCalendarItem(item)}
                                        className={
                                          isSelectedItem
                                            ? `w-full rounded-md border border-slate-900 px-2 py-1 text-left shadow-sm ${importanceCardClass(importanceTone)}`
                                            : `w-full rounded-md border border-slate-200 px-2 py-1 text-left ${importanceCardClass(importanceTone)}`
                                        }
                                      >
                                        <p className="text-[10px] font-semibold text-slate-500">{formatTimeTR(item.when)}</p>
                                        <p className="truncate text-[11px] font-medium text-slate-800">
                                          <span className={`mr-1 inline-block h-2 w-2 rounded-full ${importanceDotClass(importanceTone)}`} />
                                          {item.title}
                                        </p>
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                              {dayItems.length > 4 ? <p className="mt-1 text-[10px] text-slate-500">+{dayItems.length - 4} kayit daha</p> : null}
                            </section>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <aside className="space-y-3">
                <section className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Secili Gun</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">{selectedDayLabel}</p>
                  <p className="text-xs text-slate-500">{selectedDayItems.length} kayit</p>
                  <ul className="mt-3 space-y-2">
                    {selectedDayItems.length === 0 ? (
                      <li className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                        Bu gun icin kayit yok.
                      </li>
                    ) : (
                      selectedDayItems.map((item) => {
                        const importanceTone = resolveImportanceTone(item);
                        const isSelected = selectedCalendarItemId === item.id;
                        return (
                          <li key={`agenda-${item.id}`}>
                            <button
                              type="button"
                              onClick={() => selectCalendarItem(item)}
                              className={
                                isSelected
                                  ? `w-full rounded-lg border border-slate-900 px-3 py-2 text-left shadow-sm ${importanceCardClass(importanceTone)}`
                                  : `w-full rounded-lg border border-slate-200 px-3 py-2 text-left ${importanceCardClass(importanceTone)}`
                              }
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-500">{item.source === 'holiday' ? 'Tum gun' : formatTimeTR(item.when)}</span>
                                <Badge variant={sourceVariant(item.source)}>{sourceLabel(item.source)}</Badge>
                              </div>
                              <p className="mt-1 text-xs font-medium text-slate-800">{item.title}</p>
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kayit Detayi</p>
                  {selectedCalendarItem ? (
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={eventKindVariant(selectedCalendarItem.eventKind)}>{eventKindLabel(selectedCalendarItem.eventKind)}</Badge>
                        <Badge variant={sourceVariant(selectedCalendarItem.source)}>{sourceLabel(selectedCalendarItem.source)}</Badge>
                        <Badge variant={temporalStatusVariant(selectedCalendarItem.temporalStatus)}>
                          {temporalStatusLabel(selectedCalendarItem.temporalStatus)}
                        </Badge>
                      </div>
                      <p className="text-sm font-semibold text-slate-800">{selectedCalendarItem.title}</p>
                      <p className="text-xs text-slate-600" suppressHydrationWarning>
                        {formatDateTimeTR(selectedCalendarItem.when)}
                      </p>
                      <p className="text-xs text-slate-600">
                        {selectedCalendarItem.caseTitle}
                        {selectedCalendarItem.caseFileNo ? ` - Dosya No: ${selectedCalendarItem.caseFileNo}` : ''}
                      </p>
                      {selectedCalendarItem.description ? <p className="text-xs text-slate-700">{selectedCalendarItem.description}</p> : null}
                      {selectedCalendarItem.assigneeName ? <p className="text-xs text-slate-600">Sorumlu: {selectedCalendarItem.assigneeName}</p> : null}
                      {selectedCalendarItem.taskType ? (
                        <p className="text-xs text-slate-600">Gorev Tipi: {taskTypeLabel(selectedCalendarItem.taskType)}</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">Detay gormek icin takvimden bir kayit secin.</p>
                  )}
                </section>

                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Yaklasan Resmi Tatiller</p>
                  <ul className="mt-2 space-y-2">
                    {upcomingHolidayItems.length === 0 ? (
                      <li className="text-xs text-amber-800/80">Secili donemde yaklasan resmi tatil bulunmuyor.</li>
                    ) : (
                      upcomingHolidayItems.map((item) => (
                        <li key={`holiday-${item.id}`} className="rounded-lg border border-amber-200 bg-white px-2 py-1.5">
                          <p className="text-xs font-semibold text-amber-900">{item.title}</p>
                          <p className="text-[11px] text-amber-800">{formatDateTimeTR(item.when)}</p>
                        </li>
                      ))
                    )}
                  </ul>
                </section>

                {upcomingItems.length > 0 ? (
                  <section className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Yaklasan Kayitlar</p>
                    <ul className="mt-2 space-y-1">
                      {upcomingItems.slice(0, 5).map((item) => (
                        <li key={`upcoming-${item.id}`} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1.5">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-slate-700">{item.title}</p>
                            <p className="text-[10px] text-slate-500">{item.source === 'holiday' ? 'Tum gun' : formatTimeTR(item.when)}</p>
                          </div>
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${importanceDotClass(resolveImportanceTone(item))}`} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </aside>
            </div>
          ) : viewMode === 'day' ? (
            dayHourGroups.length === 0 ? (
              <p className="text-sm text-slate-500">Secili gun icin takvim kaydi bulunmuyor.</p>
            ) : (
              <div className="space-y-3">
                {dayHourGroups.map((group) => (
                  <section key={group.hour} className="rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                      {String(group.hour).padStart(2, '0')}:00
                    </div>
                    <ul className="space-y-2 p-3">
                      {group.items.map((item) => {
                        const googleUrl = buildGoogleCalendarUrl(item);
                        const importanceTone = resolveImportanceTone(item);
                        return (
                          <li key={item.id} className={`rounded-lg border border-slate-200 px-3 py-2 ${importanceCardClass(importanceTone)}`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={eventKindVariant(item.eventKind)}>{eventKindLabel(item.eventKind)}</Badge>
                              <Badge variant={workflowStatusVariant(item.workflowStatus)}>{workflowStatusLabel(item.workflowStatus)}</Badge>
                              <Badge variant={temporalStatusVariant(item.temporalStatus)}>{temporalStatusLabel(item.temporalStatus)}</Badge>
                              <Badge variant={importanceBadgeVariant(importanceTone)}>{importanceBadgeLabel(importanceTone)}</Badge>
                              <span className="text-xs text-slate-500">{formatTimeTR(item.when)}</span>
                            </div>
                            <p className="mt-1 text-sm font-medium text-slate-900">{item.title}</p>
                            <p className="text-xs text-slate-600">
                              {item.caseTitle}
                              {item.caseFileNo ? ` - Dosya No: ${item.caseFileNo}` : ''}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {!isCalendarOnly ? (
                                item.canEdit ? (
                                  <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={() => startEditing(item)}>
                                    Duzenle
                                  </Button>
                                ) : (
                                  <Badge variant="muted">Senkron Kayit</Badge>
                                )
                              ) : null}
                              {googleUrl ? (
                                <a
                                  href={googleUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300"
                                >
                                  Google Takvime Ekle
                                </a>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )
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
                            dayItems.map((item) => {
                              const googleUrl = buildGoogleCalendarUrl(item);
                              const importanceTone = resolveImportanceTone(item);
                              return (
                                <li key={item.id} className={`rounded-lg border border-slate-200 px-2 py-2 ${importanceCardClass(importanceTone)}`}>
                                  <p className="text-[11px] font-semibold text-slate-500">{formatTimeTR(item.when)}</p>
                                  <p className="mt-1 break-words text-xs font-medium text-slate-800">{item.title}</p>
                                  <div className="mt-2 flex items-center gap-1">
                                    <Badge variant={eventKindVariant(item.eventKind)} className="text-[10px]">
                                      {eventKindLabel(item.eventKind)}
                                    </Badge>
                                    <Badge variant={workflowStatusVariant(item.workflowStatus)} className="text-[10px]">
                                      {workflowStatusLabel(item.workflowStatus)}
                                    </Badge>
                                    <Badge variant={temporalStatusVariant(item.temporalStatus)} className="text-[10px]">
                                      {temporalStatusLabel(item.temporalStatus)}
                                    </Badge>
                                    <Badge variant={importanceBadgeVariant(importanceTone)} className="text-[10px]">
                                      {importanceBadgeLabel(importanceTone)}
                                    </Badge>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {!isCalendarOnly && item.canEdit ? (
                                      <button
                                        type="button"
                                        onClick={() => startEditing(item)}
                                        className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:border-slate-300"
                                      >
                                        Duzenle
                                      </button>
                                    ) : null}
                                    {googleUrl ? (
                                      <a
                                        href={googleUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:border-slate-300"
                                      >
                                        Google
                                      </a>
                                    ) : null}
                                  </div>
                                </li>
                              );
                            })
                          )}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : viewMode === 'month' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-7 gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {['Pzt', 'Sal', 'Car', 'Per', 'Cum', 'Cts', 'Paz'].map((label) => (
                  <div key={label} className="rounded-lg bg-slate-50 px-2 py-1 text-center">
                    {label}
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <div className="grid min-w-[980px] grid-cols-7 gap-2">
                  {monthGridDays.map((day) => {
                    const dayKey = toLocalDateKey(day);
                    const dayItems = weekItemsByDay.get(dayKey) ?? [];
                    const inCurrentMonth = day.getMonth() === monthStartDate.getMonth();
                    return (
                      <section
                        key={dayKey}
                        className={
                          inCurrentMonth
                            ? 'min-h-[140px] rounded-xl border border-slate-200 bg-white p-2'
                            : 'min-h-[140px] rounded-xl border border-slate-100 bg-slate-50/80 p-2'
                        }
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <p className={inCurrentMonth ? 'text-xs font-semibold text-slate-700' : 'text-xs font-semibold text-slate-400'}>
                            {day.toLocaleDateString('tr-TR', { day: '2-digit' })}
                          </p>
                          {dayItems.length > 0 ? <span className="text-[10px] text-slate-500">{dayItems.length} kayit</span> : null}
                        </div>
                        <ul className="space-y-1">
                          {dayItems.slice(0, 3).map((item) => {
                            const importanceTone = resolveImportanceTone(item);
                            const colorClass = importanceCardClass(importanceTone);
                            const chipClass =
                              importanceTone === 'high'
                                ? 'bg-red-500'
                                : importanceTone === 'normal'
                                  ? 'bg-blue-500'
                                  : importanceTone === 'low'
                                    ? 'bg-emerald-500'
                                    : importanceTone === 'holiday'
                                      ? 'bg-amber-500'
                                      : 'bg-slate-400';
                            return (
                              <li key={item.id}>
                                {item.canEdit && !isCalendarOnly ? (
                                  <button
                                    type="button"
                                    onClick={() => startEditing(item)}
                                    className={`w-full rounded-md border border-slate-200 px-2 py-1 text-left hover:border-slate-300 ${colorClass}`}
                                  >
                                    <p className="text-[10px] font-semibold text-slate-500">{formatTimeTR(item.when)}</p>
                                    <p className="truncate text-[11px] font-medium text-slate-800">
                                      <span className={`mr-1 inline-block h-2 w-2 rounded-full ${chipClass}`} />
                                      {item.title}
                                    </p>
                                  </button>
                                ) : (
                                  <div className={`w-full rounded-md border border-slate-200 px-2 py-1 text-left ${colorClass}`}>
                                    <p className="text-[10px] font-semibold text-slate-500">{formatTimeTR(item.when)}</p>
                                    <p className="truncate text-[11px] font-medium text-slate-800">
                                      <span className={`mr-1 inline-block h-2 w-2 rounded-full ${chipClass}`} />
                                      {item.title}
                                    </p>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        {dayItems.length > 3 ? <p className="mt-1 text-[10px] text-slate-500">+{dayItems.length - 3} kayit daha</p> : null}
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
                    {groupedItems[dayKey].map((item) => {
                      const googleUrl = buildGoogleCalendarUrl(item);
                      const importanceTone = resolveImportanceTone(item);
                      return (
                        <li key={item.id} className={`space-y-2 px-3 py-3 ${importanceCardClass(importanceTone)}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={eventKindVariant(item.eventKind)}>{eventKindLabel(item.eventKind)}</Badge>
                            <Badge variant={workflowStatusVariant(item.workflowStatus)}>{workflowStatusLabel(item.workflowStatus)}</Badge>
                            <Badge variant={temporalStatusVariant(item.temporalStatus)}>{temporalStatusLabel(item.temporalStatus)}</Badge>
                            <Badge variant={importanceBadgeVariant(importanceTone)}>{importanceBadgeLabel(importanceTone)}</Badge>
                            <Badge variant="outline">{sourceLabel(item.source)}</Badge>
                            {item.syncKind === 'task_pre_reminder' ? <Badge variant="warning">Oto Hatirlatma</Badge> : null}
                            {item.source === 'task_deadline' ? <Badge variant="success">Task Senkron</Badge> : null}
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
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                            {item.assigneeName ? <span>Sorumlu: {item.assigneeName}</span> : null}
                            {item.taskType ? <span>Tip: {taskTypeLabel(item.taskType)}</span> : null}
                            {item.deadlineType ? <span>Sure: {deadlineTypeLabel(item.deadlineType)}</span> : null}
                            {item.riskLevel ? <span>Risk: {riskLevelLabel(item.riskLevel)}</span> : null}
                            {item.confidentiality ? <span>Gizlilik: {confidentialityLabel(item.confidentiality)}</span> : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {!isCalendarOnly ? (
                              item.canEdit ? (
                                <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={() => startEditing(item)}>
                                  Duzenle
                                </Button>
                              ) : (
                                <Badge variant="muted">Senkron Kayit</Badge>
                              )
                            ) : null}
                            {googleUrl ? (
                              <a
                                href={googleUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300"
                              >
                                Google Takvime Ekle
                              </a>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
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
