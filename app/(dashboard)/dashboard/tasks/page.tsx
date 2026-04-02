'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTR } from '@/lib/date';
import { fetchDashboardCases } from '@/lib/queries';

type TaskType =
  | 'follow_up'
  | 'petition_drafting'
  | 'contract_review'
  | 'precedent_research'
  | 'hearing_preparation'
  | 'client_meeting'
  | 'service_tracking'
  | 'uyap_control';

type TaskDeadlineType = 'due_date' | 'objection_deadline' | 'response_deadline' | 'hearing_date' | 'service_control';
type TaskRiskLevel = 'low' | 'medium' | 'critical';
type TaskConfidentiality = 'team' | 'restricted';
type TaskEntryMode = 'quick' | 'smart';

type TaskDocumentItem = {
  id: string;
  publicRefCode: string;
  fileName: string;
};

type TaskListItem = {
  id: string;
  caseId: string | null;
  caseTitle: string | null;
  title: string;
  description: string | null;
  status: 'open' | 'in_progress' | 'done';
  priority: 'low' | 'normal' | 'high';
  assignedTo: string | null;
  assignedName: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  taskType: TaskType;
  deadlineType: TaskDeadlineType;
  riskLevel: TaskRiskLevel;
  confidentiality: TaskConfidentiality;
};

type TeamMemberItem = {
  id: string;
  fullName: string | null;
  role: 'lawyer' | 'assistant';
  isCurrentUser: boolean;
};

type TaskAiAssistPayload = {
  subtasks: string[];
  missingFields: string[];
  reminderSuggestion: string;
  templateSuggestion: string;
  suggestedPriority: 'low' | 'normal' | 'high';
  suggestedRiskLevel: TaskRiskLevel;
  suggestedDeadlineType: TaskDeadlineType;
  model?: {
    provider: string;
    id: string;
  };
};

const TASK_TYPE_OPTIONS: Array<{ value: TaskType; label: string }> = [
  { value: 'follow_up', label: 'Takip Gorevi' },
  { value: 'petition_drafting', label: 'Dilekce Hazirlama' },
  { value: 'contract_review', label: 'Sozlesme Inceleme' },
  { value: 'precedent_research', label: 'Ictihat Arastirmasi' },
  { value: 'hearing_preparation', label: 'Durusma Hazirligi' },
  { value: 'client_meeting', label: 'Muvekkil Gorusmesi' },
  { value: 'service_tracking', label: 'Tebligat Takibi' },
  { value: 'uyap_control', label: 'UYAP / Mahkeme Kontrolu' },
];

const TASK_DEADLINE_TYPE_OPTIONS: Array<{ value: TaskDeadlineType; label: string }> = [
  { value: 'due_date', label: 'Genel Son Tarih' },
  { value: 'objection_deadline', label: 'Itiraz Suresi' },
  { value: 'response_deadline', label: 'Cevap Suresi' },
  { value: 'hearing_date', label: 'Durusma Tarihi' },
  { value: 'service_control', label: 'Tebligat Kontrol Tarihi' },
];

function getStatusLabel(status: TaskListItem['status']) {
  if (status === 'open') return 'Acik';
  if (status === 'in_progress') return 'Devam Ediyor';
  return 'Tamamlandi';
}

function getStatusVariant(status: TaskListItem['status']): 'blue' | 'orange' | 'muted' {
  if (status === 'open') return 'blue';
  if (status === 'in_progress') return 'orange';
  return 'muted';
}

function getPriorityLabel(priority: TaskListItem['priority']) {
  if (priority === 'high') return 'Acil';
  if (priority === 'low') return 'Vakti Olan';
  return 'Ortalama';
}

function getPriorityVariant(priority: TaskListItem['priority']): 'critical' | 'blue' | 'success' {
  if (priority === 'high') return 'critical';
  if (priority === 'low') return 'success';
  return 'blue';
}

function isTaskOverdue(task: TaskListItem) {
  if (task.status === 'done' || !task.dueAt) return false;
  const dueAtTs = new Date(task.dueAt).getTime();
  if (!Number.isFinite(dueAtTs)) return false;
  return dueAtTs < Date.now();
}

async function fetchDashboardTasks(): Promise<{ items: TaskListItem[] }> {
  const response = await fetch('/api/dashboard/tasks', { cache: 'no-store' });
  const payload = (await response.json()) as { items?: TaskListItem[]; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? 'Gorevler alinamadi.');
  }
  return {
    items: payload.items ?? [],
  };
}

function DashboardTasksPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const handledQuickTaskSearchRef = useRef<string | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TaskListItem['status']>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | TaskListItem['priority']>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [entryMode, setEntryMode] = useState<TaskEntryMode>('quick');
  const [modalOpen, setModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [taskCaseId, setTaskCaseId] = useState('');
  const [taskTitle, setTaskTitle] = useState('Takip Gorevi');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskPriority, setTaskPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [taskType, setTaskType] = useState<TaskType>('follow_up');
  const [taskDeadlineType, setTaskDeadlineType] = useState<TaskDeadlineType>('due_date');
  const [taskRiskLevel, setTaskRiskLevel] = useState<TaskRiskLevel>('medium');
  const [taskConfidentiality, setTaskConfidentiality] = useState<TaskConfidentiality>('team');
  const [taskCourt, setTaskCourt] = useState('');
  const [taskCourtFileNo, setTaskCourtFileNo] = useState('');
  const [taskOpponent, setTaskOpponent] = useState('');
  const [taskReferenceInput, setTaskReferenceInput] = useState('');
  const [taskAttachmentNotes, setTaskAttachmentNotes] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskAssignedTo, setTaskAssignedTo] = useState('');

  const [taskAiSubtasks, setTaskAiSubtasks] = useState<string[]>([]);
  const [taskAiMissingFields, setTaskAiMissingFields] = useState<string[]>([]);
  const [taskAiReminder, setTaskAiReminder] = useState('');
  const [taskAiTemplate, setTaskAiTemplate] = useState('');
  const [taskAiModel, setTaskAiModel] = useState<{ provider: string; id: string } | null>(null);
  const [isGeneratingTaskAssist, setIsGeneratingTaskAssist] = useState(false);

  const [taskDocuments, setTaskDocuments] = useState<TaskDocumentItem[]>([]);
  const [selectedTaskDocumentIds, setSelectedTaskDocumentIds] = useState<string[]>([]);
  const [isTaskDocumentsLoading, setIsTaskDocumentsLoading] = useState(false);

  const {
    data: tasksData,
    isLoading: isTasksLoading,
    isError: isTasksError,
    error: tasksError,
    refetch: refetchTasks,
  } = useQuery<{ items: TaskListItem[] }, Error>({
    queryKey: ['dashboard', 'tasks'],
    queryFn: fetchDashboardTasks,
  });

  const { data: teamMembers = [] } = useQuery<TeamMemberItem[], Error>({
    queryKey: ['dashboard', 'tasks', 'team-members'],
    queryFn: async () => {
      const response = await fetch('/api/office/team/members', { cache: 'no-store' });
      const payload = (await response.json()) as { members?: TeamMemberItem[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Ekip uyeleri alinamadi.');
      }
      return payload.members ?? [];
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: casesData } = useQuery<Awaited<ReturnType<typeof fetchDashboardCases>>, Error>({
    queryKey: ['dashboard', 'tasks', 'cases'],
    queryFn: () =>
      fetchDashboardCases({
        page: 1,
        pageSize: 100,
        quickView: 'all',
        statusFilter: 'all',
        sortBy: 'updated_desc',
      }),
    staleTime: 1000 * 60 * 2,
  });

  const tasks = tasksData?.items ?? [];
  const caseOptions = casesData?.items ?? [];

  const filteredTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (statusFilter !== 'all' && task.status !== statusFilter) {
          return false;
        }
        if (priorityFilter !== 'all' && task.priority !== priorityFilter) {
          return false;
        }
        if (overdueOnly && !isTaskOverdue(task)) {
          return false;
        }
        if (!query.trim()) {
          return true;
        }

        const haystack = [
          task.title,
          task.description ?? '',
          task.caseTitle ?? '',
          task.assignedName ?? '',
          task.taskType,
          task.deadlineType,
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(query.trim().toLowerCase());
      }),
    [overdueOnly, priorityFilter, query, statusFilter, tasks]
  );

  const stats = useMemo(
    () => ({
      total: tasks.length,
      open: tasks.filter((task) => task.status === 'open').length,
      inProgress: tasks.filter((task) => task.status === 'in_progress').length,
      done: tasks.filter((task) => task.status === 'done').length,
      highPriority: tasks.filter((task) => task.priority === 'high').length,
      normalPriority: tasks.filter((task) => task.priority === 'normal').length,
      lowPriority: tasks.filter((task) => task.priority === 'low').length,
      overdue: tasks.filter((task) => isTaskOverdue(task)).length,
    }),
    [tasks]
  );

  function getPreferredTaskAssigneeId(): string {
    const currentUser = teamMembers.find((member) => member.isCurrentUser);
    return currentUser?.id ?? teamMembers[0]?.id ?? '';
  }

  function resetTaskDraft(options?: { assigneeId?: string; mode?: TaskEntryMode }) {
    setEntryMode(options?.mode ?? 'quick');
    setTaskCaseId(caseOptions[0]?.id ?? '');
    setTaskTitle('Takip Gorevi');
    setTaskDescription('');
    setTaskPriority('normal');
    setTaskType('follow_up');
    setTaskDeadlineType('due_date');
    setTaskRiskLevel('medium');
    setTaskConfidentiality('team');
    setTaskCourt('');
    setTaskCourtFileNo('');
    setTaskOpponent('');
    setTaskReferenceInput('');
    setTaskAttachmentNotes('');
    setTaskAiSubtasks([]);
    setTaskAiMissingFields([]);
    setTaskAiReminder('');
    setTaskAiTemplate('');
    setTaskAiModel(null);
    setTaskDocuments([]);
    setSelectedTaskDocumentIds([]);
    setTaskDueAt('');
    setTaskAssignedTo(options?.assigneeId ?? '');
  }

  function openCreateModal(mode: TaskEntryMode = 'smart') {
    resetTaskDraft({ assigneeId: getPreferredTaskAssigneeId(), mode });
    const firstCaseId = caseOptions[0]?.id ?? '';
    setTaskCaseId(firstCaseId);
    if (firstCaseId) {
      loadTaskCaseDocuments(firstCaseId).catch(() => {
        setStatusMessage('Gorev belgeleri yuklenemedi.');
      });
    }
    setModalOpen(true);
  }

  useEffect(() => {
    const shouldOpenTaskModal = searchParams.get('openTask') === '1';
    if (!shouldOpenTaskModal) {
      handledQuickTaskSearchRef.current = null;
      return;
    }

    const currentSearch = searchParams.toString();
    if (handledQuickTaskSearchRef.current === currentSearch) {
      return;
    }
    handledQuickTaskSearchRef.current = currentSearch;

    openCreateModal('smart');

    const nextParams = new URLSearchParams(currentSearch);
    nextParams.delete('openTask');
    const nextSearch = nextParams.toString();
    router.replace((nextSearch ? `${pathname}?${nextSearch}` : pathname) as Route, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (teamMembers.length === 0 || taskAssignedTo) {
      return;
    }
    setTaskAssignedTo(getPreferredTaskAssigneeId());
  }, [teamMembers, taskAssignedTo]);

  async function loadTaskCaseDocuments(caseId: string) {
    if (!caseId) {
      setTaskDocuments([]);
      setSelectedTaskDocumentIds([]);
      return;
    }

    setIsTaskDocumentsLoading(true);
    try {
      const response = await fetch(`/api/dashboard/cases/documents?caseId=${encodeURIComponent(caseId)}`, { cache: 'no-store' });
      const payload = (await response.json()) as { items?: TaskDocumentItem[]; error?: string };
      if (!response.ok) {
        setTaskDocuments([]);
        setSelectedTaskDocumentIds([]);
        setStatusMessage(payload.error ?? 'Gorev belgeleri alinamadi.');
        return;
      }

      setTaskDocuments(payload.items ?? []);
      setSelectedTaskDocumentIds((previous) =>
        previous.filter((id) => (payload.items ?? []).some((item) => item.id === id))
      );
    } catch {
      setTaskDocuments([]);
      setSelectedTaskDocumentIds([]);
      setStatusMessage('Gorev belgeleri yuklenirken hata olustu.');
    } finally {
      setIsTaskDocumentsLoading(false);
    }
  }

  async function requestTaskAiAssist() {
    if (taskTitle.trim().length < 3) {
      setStatusMessage('AI onerisi icin gorev basligi en az 3 karakter olmali.');
      return;
    }

    setIsGeneratingTaskAssist(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/dashboard/cases/tasks/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: taskCaseId || undefined,
          title: taskTitle.trim(),
          description: taskDescription.trim() || undefined,
          taskType,
          deadlineType: taskDeadlineType,
          dueAt: taskDueAt ? new Date(taskDueAt).toISOString() : undefined,
        }),
      });

      const payload = (await response.json()) as { suggestion?: TaskAiAssistPayload; error?: string };
      if (!response.ok || !payload.suggestion) {
        setStatusMessage(payload.error ?? 'AI gorev onerisi alinamadi.');
        return;
      }

      const suggestion = payload.suggestion;
      setTaskAiSubtasks(suggestion.subtasks ?? []);
      setTaskAiMissingFields(suggestion.missingFields ?? []);
      setTaskAiReminder(suggestion.reminderSuggestion ?? '');
      setTaskAiTemplate(suggestion.templateSuggestion ?? '');
      setTaskAiModel(suggestion.model ?? null);
      setTaskPriority(suggestion.suggestedPriority ?? 'normal');
      setTaskRiskLevel(suggestion.suggestedRiskLevel ?? 'medium');
      setTaskDeadlineType(suggestion.suggestedDeadlineType ?? 'due_date');
      setEntryMode('smart');
    } catch {
      setStatusMessage('AI onerisi alinirken hata olustu.');
    } finally {
      setIsGeneratingTaskAssist(false);
    }
  }

  async function submitTask() {
    if (taskTitle.trim().length < 3) {
      setStatusMessage('Gorev basligi en az 3 karakter olmali.');
      return;
    }

    if (!taskCaseId) {
      setStatusMessage('Gorev icin dosya secimi zorunludur.');
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/dashboard/cases/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: taskCaseId,
          title: taskTitle.trim(),
          description: taskDescription.trim() || undefined,
          priority: taskPriority,
          dueAt: taskDueAt ? new Date(taskDueAt).toISOString() : undefined,
          assignedTo: taskAssignedTo || undefined,
          taskType,
          deadlineType: taskDeadlineType,
          riskLevel: taskRiskLevel,
          confidentiality: taskConfidentiality,
          court: taskCourt.trim() || undefined,
          fileNo: taskCourtFileNo.trim() || undefined,
          opponent: taskOpponent.trim() || undefined,
          references: taskReferenceInput
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          selectedDocumentIds: selectedTaskDocumentIds,
          attachmentNotes: taskAttachmentNotes.trim() || undefined,
          aiContext:
            taskAiSubtasks.length > 0 || taskAiMissingFields.length > 0 || taskAiReminder || taskAiTemplate
              ? {
                  subtasks: taskAiSubtasks,
                  missingFields: taskAiMissingFields,
                  reminderSuggestion: taskAiReminder || undefined,
                  templateSuggestion: taskAiTemplate || undefined,
                  model: taskAiModel ?? undefined,
                }
              : undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatusMessage(payload.error ?? 'Gorev olusturulamadi.');
        return;
      }

      setStatusMessage('Gorev olusturuldu.');
      setModalOpen(false);
      resetTaskDraft({ assigneeId: getPreferredTaskAssigneeId(), mode: 'quick' });
      await refetchTasks();
    } catch {
      setStatusMessage('Gorev olusturulurken hata olustu.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 text-[var(--text)] font-sans" style={{ fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif' }}>
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Gorevler</CardTitle>
              <p className="text-sm text-slate-500">Tum hukuk gorevlerini tek ekranda yonetin.</p>
            </div>
            <Button type="button" onClick={() => openCreateModal('smart')} className="h-11 rounded-xl bg-gradient-to-r from-blue-600 to-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-slate-950">
              + Gorev Ekle
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <p className="text-xs text-slate-500">Toplam Gorev</p>
              <p className="text-xl font-semibold text-slate-900">{isTasksLoading ? '...' : stats.total}</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              <p className="text-xs text-blue-700">Acik</p>
              <p className="text-xl font-semibold text-blue-900">{isTasksLoading ? '...' : stats.open}</p>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm">
              <p className="text-xs text-orange-700">Devam Ediyor</p>
              <p className="text-xl font-semibold text-orange-900">{isTasksLoading ? '...' : stats.inProgress}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <p className="text-xs text-slate-600">Tamamlandi</p>
              <p className="text-xl font-semibold text-slate-900">{isTasksLoading ? '...' : stats.done}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <button
              type="button"
              onClick={() => setOverdueOnly((prev) => !prev)}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                overdueOnly
                  ? 'border-red-400 bg-red-100 ring-2 ring-red-200'
                  : 'border-red-300 bg-red-50 hover:bg-red-100'
              }`}
              aria-pressed={overdueOnly}
            >
              <p className="text-xs text-red-700">Geciken</p>
              <p className="text-xl font-semibold text-red-900">{isTasksLoading ? '...' : stats.overdue}</p>
            </button>
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm">
              <p className="text-xs text-red-700">Acil</p>
              <p className="text-xl font-semibold text-red-900">{isTasksLoading ? '...' : stats.highPriority}</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              <p className="text-xs text-blue-700">Ortalama</p>
              <p className="text-xl font-semibold text-blue-900">{isTasksLoading ? '...' : stats.normalPriority}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
              <p className="text-xs text-emerald-700">Vakti Olan</p>
              <p className="text-xl font-semibold text-emerald-900">{isTasksLoading ? '...' : stats.lowPriority}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_220px_220px]">
            <Input
              placeholder="Gorev, dosya veya sorumlu adina gore ara"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | TaskListItem['status'])}
              className="h-10 rounded-md border border-input bg-white px-3 text-sm"
            >
              <option value="all">Tum durumlar</option>
              <option value="open">Acik</option>
              <option value="in_progress">Devam Ediyor</option>
              <option value="done">Tamamlandi</option>
            </select>

            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value as 'all' | TaskListItem['priority'])}
              className="h-10 rounded-md border border-input bg-white px-3 text-sm"
            >
              <option value="all">Tum oncelikler</option>
              <option value="high">Acil</option>
              <option value="normal">Ortalama</option>
              <option value="low">Vakti Olan</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={overdueOnly ? 'destructive' : 'outline'}
              onClick={() => setOverdueOnly((prev) => !prev)}
            >
              {overdueOnly ? 'Geciken Filtresi Acik' : 'Sadece Geciken'}
              {!isTasksLoading ? ` (${stats.overdue})` : ''}
            </Button>
            {overdueOnly ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setOverdueOnly(false)}>
                Filtreyi Kapat
              </Button>
            ) : null}
          </div>

          {statusMessage ? <p className="text-xs text-slate-600">{statusMessage}</p> : null}

          {isTasksLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : isTasksError ? (
            <p className="text-sm text-orange-600">{tasksError instanceof Error ? tasksError.message : 'Gorev listesi alinamadi.'}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="px-4 py-3">Gorev</th>
                    <th className="px-4 py-3">Dosya</th>
                    <th className="px-4 py-3">Durum</th>
                    <th className="px-4 py-3">Oncelik</th>
                    <th className="px-4 py-3">Sorumlu</th>
                    <th className="px-4 py-3">Yasal Tarih</th>
                    <th className="px-4 py-3">Son Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                        Filtreye uygun gorev bulunamadi.
                      </td>
                    </tr>
                  ) : (
                    filteredTasks.map((task) => {
                      const taskOverdue = isTaskOverdue(task);
                      return (
                        <tr key={task.id} className={`border-t border-border ${taskOverdue ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-slate-50/60'}`}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{task.title}</p>
                            {task.description ? <p className="mt-1 line-clamp-2 text-xs text-slate-500">{task.description}</p> : null}
                          </td>
                          <td className="px-4 py-3">
                            {task.caseId && task.caseTitle ? (
                              <Link href={`/dashboard/cases/${task.caseId}` as Route} className="text-blue-600 hover:underline">
                                {task.caseTitle}
                              </Link>
                            ) : (
                              <span className="text-slate-500">Bagli dosya yok</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={getStatusVariant(task.status)}>{getStatusLabel(task.status)}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={getPriorityVariant(task.priority)}>{getPriorityLabel(task.priority)}</Badge>
                          </td>
                          <td className="px-4 py-3">{task.assignedName ?? 'Atanmamis'}</td>
                          <td className="px-4 py-3">
                            {TASK_DEADLINE_TYPE_OPTIONS.find((option) => option.value === task.deadlineType)?.label ?? 'Genel Son Tarih'}
                          </td>
                          <td className="px-4 py-3" suppressHydrationWarning>
                            {task.dueAt ? (
                              <div className="flex flex-col gap-1">
                                <span>{formatDateTR(task.dueAt)}</span>
                                {taskOverdue ? <Badge variant="critical">Gecikti</Badge> : null}
                              </div>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Gorev Ekle</h3>
            <p className="mt-1 text-sm text-slate-600">Hizli veya AI destekli akilli gorev olusturabilirsiniz.</p>

            <div className="mt-3 max-h-[75vh] space-y-3 overflow-y-auto pr-1">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={
                        entryMode === 'quick'
                          ? 'rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white'
                          : 'rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700'
                      }
                      onClick={() => setEntryMode('quick')}
                    >
                      Hizli Gorev Ekle
                    </button>
                    <button
                      type="button"
                      className={
                        entryMode === 'smart'
                          ? 'rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white'
                          : 'rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700'
                      }
                      onClick={() => setEntryMode('smart')}
                    >
                      Akilli Gorev Ekle
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {taskAiModel ? (
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                        AI: {taskAiModel.provider}/{taskAiModel.id}
                      </span>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" disabled={isGeneratingTaskAssist} onClick={requestTaskAiAssist}>
                      {isGeneratingTaskAssist ? 'AI Oneriyor...' : 'AI ile Alt Gorev Oner'}
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Bagli Dosya / Dava</label>
                <select
                  value={taskCaseId}
                  onChange={(event) => {
                    const nextCaseId = event.target.value;
                    setTaskCaseId(nextCaseId);
                    const selectedCase = caseOptions.find((item) => item.id === nextCaseId);
                    if (selectedCase && (taskTitle === 'Takip Gorevi' || taskTitle.trim().length === 0)) {
                      setTaskTitle(`${selectedCase.title} - Takip Gorevi`);
                    }
                    loadTaskCaseDocuments(nextCaseId).catch(() => {
                      setStatusMessage('Gorev belgeleri yuklenemedi.');
                    });
                  }}
                  className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                >
                  <option value="">Dosya secin</option>
                  {caseOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Gorev Basligi</label>
                <Input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Orn: Dava dilekcesi hazirla" />
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Oncelik</label>
                  <select
                    value={taskPriority}
                    onChange={(event) => setTaskPriority(event.target.value as 'low' | 'normal' | 'high')}
                    className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                  >
                    <option value="low">Vakti Olan</option>
                    <option value="normal">Ortalama</option>
                    <option value="high">Acil</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Sorumlu</label>
                  <select
                    value={taskAssignedTo}
                    onChange={(event) => setTaskAssignedTo(event.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                  >
                    {teamMembers.length === 0 ? <option value="">Atama yapilmadi</option> : null}
                    {teamMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {(member.fullName ?? 'Isimsiz kullanici') + (member.isCurrentUser ? ' (Ben)' : '')}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Yasal Tarih Turu</label>
                  <select
                    value={taskDeadlineType}
                    onChange={(event) => setTaskDeadlineType(event.target.value as TaskDeadlineType)}
                    className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                  >
                    {TASK_DEADLINE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Son Tarih / Termin</label>
                  <Input type="datetime-local" value={taskDueAt} onChange={(event) => setTaskDueAt(event.target.value)} />
                </div>
              </div>

              {entryMode === 'smart' ? (
                <>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Gorev Tipi</label>
                      <select
                        value={taskType}
                        onChange={(event) => setTaskType(event.target.value as TaskType)}
                        className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                      >
                        {TASK_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Risk Seviyesi</label>
                      <select
                        value={taskRiskLevel}
                        onChange={(event) => setTaskRiskLevel(event.target.value as TaskRiskLevel)}
                        className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                      >
                        <option value="low">Dusuk</option>
                        <option value="medium">Orta</option>
                        <option value="critical">Kritik</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Gizlilik</label>
                      <select
                        value={taskConfidentiality}
                        onChange={(event) => setTaskConfidentiality(event.target.value as TaskConfidentiality)}
                        className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                      >
                        <option value="team">Ekip</option>
                        <option value="restricted">Sadece Yetkililer</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Mahkeme</label>
                      <Input value={taskCourt} onChange={(event) => setTaskCourt(event.target.value)} placeholder="Orn: Istanbul 4. Asliye Hukuk" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Dosya No</label>
                      <Input value={taskCourtFileNo} onChange={(event) => setTaskCourtFileNo(event.target.value)} placeholder="Orn: 2025/217 E." />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Karsi Taraf</label>
                      <Input value={taskOpponent} onChange={(event) => setTaskOpponent(event.target.value)} placeholder="Orn: ABC A.S." />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Aciklama</label>
                      <textarea
                        value={taskDescription}
                        onChange={(event) => setTaskDescription(event.target.value)}
                        className="min-h-24 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                        placeholder="Gorevin kapsamini yazin"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Ilgili Not / Konusma Referanslari</label>
                      <textarea
                        value={taskReferenceInput}
                        onChange={(event) => setTaskReferenceInput(event.target.value)}
                        className="min-h-24 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                        placeholder="Her satira bir referans"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Ek Aciklama / Belge Notu</label>
                    <textarea
                      value={taskAttachmentNotes}
                      onChange={(event) => setTaskAttachmentNotes(event.target.value)}
                      className="min-h-20 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                      placeholder="Ek belge veya talimat notu"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Iliştirilecek Dosya Belgeleri</label>
                    {isTaskDocumentsLoading ? (
                      <p className="text-xs text-slate-500">Belgeler yukleniyor...</p>
                    ) : taskDocuments.length === 0 ? (
                      <p className="text-xs text-slate-500">Bu dosyada ilistirilecek belge bulunamadi.</p>
                    ) : (
                      <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                        {taskDocuments.map((doc) => (
                          <label key={doc.id} className="flex items-center gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={selectedTaskDocumentIds.includes(doc.id)}
                              onChange={(event) => {
                                setSelectedTaskDocumentIds((previous) =>
                                  event.target.checked ? [...previous, doc.id] : previous.filter((id) => id !== doc.id)
                                );
                              }}
                            />
                            <span>{doc.fileName}</span>
                            <span className="text-slate-400">({doc.publicRefCode})</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {taskAiSubtasks.length > 0 || taskAiMissingFields.length > 0 || taskAiReminder || taskAiTemplate ? (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">AI Onerileri</p>
                      {taskAiSubtasks.length > 0 ? (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-blue-700">Alt Gorevler</p>
                          <ul className="mt-1 space-y-1 text-xs text-blue-900">
                            {taskAiSubtasks.map((item, index) => (
                              <li key={`${item}-${index}`}>- {item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {taskAiMissingFields.length > 0 ? (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-orange-700">Eksik Bilgi Uyarisi</p>
                          <ul className="mt-1 space-y-1 text-xs text-orange-900">
                            {taskAiMissingFields.map((item, index) => (
                              <li key={`${item}-${index}`}>- {item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {taskAiReminder ? <p className="mt-2 text-xs text-slate-700">Hatirlatma: {taskAiReminder}</p> : null}
                      {taskAiTemplate ? <p className="mt-1 text-xs text-slate-700">Sablon Onerisi: {taskAiTemplate}</p> : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setModalOpen(false);
                  resetTaskDraft({ assigneeId: getPreferredTaskAssigneeId(), mode: 'quick' });
                }}
              >
                Vazgec
              </Button>
              <Button type="button" disabled={isSubmitting || taskTitle.trim().length < 3 || !taskCaseId} onClick={submitTask}>
                Gorev Olustur
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function DashboardTasksPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-slate-500">Gorevler yukleniyor...</div>}>
      <DashboardTasksPageContent />
    </Suspense>
  );
}
