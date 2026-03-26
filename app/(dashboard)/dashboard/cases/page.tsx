'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTR } from '@/lib/date';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { fetchDashboardCases } from '@/lib/queries';
import type { CaseStatus } from '@/types';

type CaseNoteItem = {
  id: string;
  message: string;
  is_public_to_client: boolean;
  created_at: string;
};

type TeamMemberItem = {
  id: string;
  fullName: string | null;
  role: 'lawyer' | 'assistant';
  isCurrentUser: boolean;
};

type CaseFormPersonItem = {
  id: string;
  fullName: string | null;
};

type ClientDirectoryItem = {
  id: string;
  type: 'client' | 'invite';
  fullName: string | null;
  username: string | null;
  email: string | null;
  status: 'registered' | 'invited' | 'accepted';
  clientId: string | null;
  fileNo?: string | null;
  publicRefCode?: string | null;
};

type TaskTemplate = {
  id: 'follow_up' | 'document_review' | 'deadline_alert' | 'client_update';
  label: string;
  title: string;
  priority: 'low' | 'normal' | 'high';
};

type TaskModalMode = 'single' | 'bulk' | 'general';
type TaskEntryMode = 'quick' | 'smart';
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

type TaskDocumentItem = {
  id: string;
  publicRefCode: string;
  fileName: string;
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
  { value: 'follow_up', label: 'Takip Görevi' },
  { value: 'petition_drafting', label: 'Dilekçe Hazırlama' },
  { value: 'contract_review', label: 'Sözleşme İnceleme' },
  { value: 'precedent_research', label: 'İçtihat Araştırması' },
  { value: 'hearing_preparation', label: 'Duruşma Hazırlığı' },
  { value: 'client_meeting', label: 'Müvekkil Görüşmesi' },
  { value: 'service_tracking', label: 'Tebligat Takibi' },
  { value: 'uyap_control', label: 'UYAP / Mahkeme Kontrolü' },
];

const TASK_DEADLINE_TYPE_OPTIONS: Array<{ value: TaskDeadlineType; label: string }> = [
  { value: 'due_date', label: 'Genel Son Tarih' },
  { value: 'objection_deadline', label: 'İtiraz Süresi' },
  { value: 'response_deadline', label: 'Cevap Süresi' },
  { value: 'hearing_date', label: 'Duruşma Tarihi' },
  { value: 'service_control', label: 'Tebligat Kontrol Tarihi' },
];

const TASK_TEMPLATES: TaskTemplate[] = [
  { id: 'follow_up', label: 'Takip', title: 'Takip Görevi', priority: 'normal' },
  { id: 'document_review', label: 'Belge İnceleme', title: 'Belge İnceleme', priority: 'normal' },
  { id: 'deadline_alert', label: 'Süre Uyarısı', title: 'Süre Kontrolü', priority: 'high' },
  { id: 'client_update', label: 'Müvekkil Bilgilendirme', title: 'Müvekkil Bilgilendirmesi', priority: 'low' },
];

const USERNAME_PATTERN = /^[a-z0-9._]+$/;

function buildCaseDisplayTitle(baseTitle: string, options: { tag: string }) {
  const trimmedTitle = baseTitle.trim();
  const trimmedTag = options.tag.trim();

  const parts = [trimmedTag ? `[${trimmedTag}]` : '', trimmedTitle].filter((item) => item.length > 0);
  return parts.join(' ').trim();
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

function getActivityRisk(updatedAt: string): { label: string; variant: 'blue' | 'orange' | 'muted' } {
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));

  if (days <= 3) {
    return { label: 'Güncel (D-3)', variant: 'blue' };
  }

  if (days <= 10) {
    return { label: `Takip (D-${days})`, variant: 'orange' };
  }

  return { label: `Gecikme Riski (D-${days})`, variant: 'muted' };
}

export default function CasesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const handledQuickTaskSearchRef = useRef<string | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CaseStatus>('all');
  const [quickView, setQuickView] = useState<'all' | 'open' | 'active' | 'updated_this_week' | 'high_risk'>('all');
  const [sortBy, setSortBy] = useState<'updated_desc' | 'updated_asc' | 'title_asc'>('updated_desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [isApplyingAction, setIsApplyingAction] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionLink, setActionLink] = useState<{ href: string; label: string } | null>(null);
  const [noteModalCase, setNoteModalCase] = useState<{ id: string; title: string } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [notePublic, setNotePublic] = useState(false);
  const [noteHistory, setNoteHistory] = useState<CaseNoteItem[]>([]);
  const [isLoadingNoteHistory, setIsLoadingNoteHistory] = useState(false);
  const [taskModal, setTaskModal] = useState<{ mode: TaskModalMode; caseId?: string; caseTitle?: string } | null>(null);
  const [taskEntryMode, setTaskEntryMode] = useState<TaskEntryMode>('quick');
  const [taskCaseId, setTaskCaseId] = useState('');
  const [taskTitle, setTaskTitle] = useState('Takip Görevi');
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
  const [taskAiSubtasks, setTaskAiSubtasks] = useState<string[]>([]);
  const [taskAiMissingFields, setTaskAiMissingFields] = useState<string[]>([]);
  const [taskAiReminder, setTaskAiReminder] = useState('');
  const [taskAiTemplate, setTaskAiTemplate] = useState('');
  const [taskAiModel, setTaskAiModel] = useState<{ provider: string; id: string } | null>(null);
  const [isGeneratingTaskAssist, setIsGeneratingTaskAssist] = useState(false);
  const [taskDocuments, setTaskDocuments] = useState<TaskDocumentItem[]>([]);
  const [selectedTaskDocumentIds, setSelectedTaskDocumentIds] = useState<string[]>([]);
  const [isTaskDocumentsLoading, setIsTaskDocumentsLoading] = useState(false);
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskAssignedTo, setTaskAssignedTo] = useState('');
  const [createCaseModalOpen, setCreateCaseModalOpen] = useState(false);
  const [createCaseStep, setCreateCaseStep] = useState<1 | 2 | 3>(1);
  const [newCaseTitle, setNewCaseTitle] = useState('');
  const [newCaseStatus, setNewCaseStatus] = useState<CaseStatus>('open');
  const [newCaseClientIds, setNewCaseClientIds] = useState<string[]>([]);
  const [newCaseClientDisplay, setNewCaseClientDisplay] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clientInviteFormOpen, setClientInviteFormOpen] = useState(false);
  const [clientInviteFullName, setClientInviteFullName] = useState('');
  const [clientInviteEmail, setClientInviteEmail] = useState('');
  const [clientInviteUsername, setClientInviteUsername] = useState('');
  const [clientDetailFullName, setClientDetailFullName] = useState('');
  const [clientDetailTcIdentity, setClientDetailTcIdentity] = useState('');
  const [clientDetailContactName, setClientDetailContactName] = useState('');
  const [clientDetailEmail, setClientDetailEmail] = useState('');
  const [clientDetailPhone, setClientDetailPhone] = useState('');
  const [clientDetailFileNo, setClientDetailFileNo] = useState('');
  const [clientDetailPartyType, setClientDetailPartyType] = useState<'' | 'plaintiff' | 'defendant' | 'consultant'>('');
  const [newCaseLawyerId, setNewCaseLawyerId] = useState('');
  const [newCaseTag, setNewCaseTag] = useState('');
  const [newCaseIncludeAutoCode, setNewCaseIncludeAutoCode] = useState(true);
  const [createInitialTask, setCreateInitialTask] = useState(false);
  const [initialTaskTitle, setInitialTaskTitle] = useState('İlk Dosya Takip Görevi');
  const [initialTaskPriority, setInitialTaskPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [initialTaskDueAt, setInitialTaskDueAt] = useState('');
  const [initialTaskAssignedTo, setInitialTaskAssignedTo] = useState('');

  const normalizedClientInviteUsername = clientInviteUsername.trim().toLowerCase();
  const isClientInviteUsernameProvided = normalizedClientInviteUsername.length > 0;
  const isClientInviteUsernameLengthValid = normalizedClientInviteUsername.length >= 3;
  const isClientInviteUsernameFormatValid = USERNAME_PATTERN.test(normalizedClientInviteUsername);
  const isClientInviteUsernameValid =
    !isClientInviteUsernameProvided || (isClientInviteUsernameLengthValid && isClientInviteUsernameFormatValid);

  const hasOptionalClientDetails = Boolean(
    clientDetailFullName.trim() ||
      clientDetailTcIdentity.trim() ||
      clientDetailContactName.trim() ||
      clientDetailEmail.trim() ||
      clientDetailPhone.trim() ||
      clientDetailFileNo.trim() ||
      clientDetailPartyType
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<
    Awaited<ReturnType<typeof fetchDashboardCases>>,
    Error
  >({
    queryKey: ['dashboard', 'cases', query, statusFilter, quickView, sortBy, page, pageSize],
    queryFn: () =>
      fetchDashboardCases({
        query,
        statusFilter,
        quickView,
        sortBy,
        page,
        pageSize,
      }),
  });

  const { data: teamMembers = [] } = useQuery<TeamMemberItem[], Error>({
    queryKey: ['dashboard', 'cases', 'team-members'],
    queryFn: async () => {
      const response = await fetch('/api/office/team/members', { cache: 'no-store' });
      const payload = (await response.json()) as { members?: TeamMemberItem[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Ekip üyeleri alınamadı.');
      }

      return payload.members ?? [];
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: caseFormMeta } = useQuery<
    {
      clients: CaseFormPersonItem[];
      lawyers: CaseFormPersonItem[];
    },
    Error
  >({
    queryKey: ['dashboard', 'cases', 'create-meta'],
    queryFn: async () => {
      const response = await fetch('/api/dashboard/cases/create', { cache: 'no-store' });
      const payload = (await response.json()) as {
        clients?: CaseFormPersonItem[];
        lawyers?: CaseFormPersonItem[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Dosya form verileri alınamadı.');
      }

      return {
        clients: payload.clients ?? [],
        lawyers: payload.lawyers ?? [],
      };
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: clientDirectory = [], refetch: refetchClientDirectory } = useQuery<ClientDirectoryItem[], Error>({
    queryKey: ['dashboard', 'cases', 'client-directory', clientSearch],
    queryFn: async () => {
      const response = await fetch(`/api/dashboard/clients?query=${encodeURIComponent(clientSearch)}`, { cache: 'no-store' });
      const payload = (await response.json()) as { directory?: ClientDirectoryItem[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Müvekkil dizini alınamadı.');
      }

      return payload.directory ?? [];
    },
    enabled: createCaseModalOpen,
    staleTime: 1000 * 30,
  });

  const filteredCases = data?.items ?? [];
  const stats = data?.stats ?? { total: 0, open: 0, inProgress: 0, closed: 0, archived: 0 };
  const pagination = data?.pagination ?? { page: 1, pageSize, total: 0, totalPages: 1 };

  const allFilteredSelected = filteredCases.length > 0 && filteredCases.every((item) => selectedCaseIds.includes(item.id));
  const taskCaseOptions = filteredCases.map((item) => ({ id: item.id, title: item.title }));
  const resolvedTaskCaseId = taskModal?.mode === 'single' ? taskModal.caseId ?? '' : taskCaseId;
  const canSubmitTask =
    taskTitle.trim().length >= 3 &&
    (taskModal?.mode === 'bulk' ? selectedCaseIds.length > 0 : resolvedTaskCaseId.length > 0);

  function resetTaskDraft(options?: { assigneeId?: string; mode?: TaskEntryMode }) {
    setTaskEntryMode(options?.mode ?? 'quick');
    setTaskCaseId('');
    setTaskTitle('Takip Görevi');
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
        setActionMessage(payload.error ?? 'Görev için dosya belgeleri alınamadı.');
        return;
      }

      setTaskDocuments(payload.items ?? []);
      setSelectedTaskDocumentIds((previous) =>
        previous.filter((id) => (payload.items ?? []).some((item) => item.id === id))
      );
    } catch {
      setTaskDocuments([]);
      setSelectedTaskDocumentIds([]);
      setActionMessage('Görev belgeleri yüklenirken beklenmeyen hata oluştu.');
    } finally {
      setIsTaskDocumentsLoading(false);
    }
  }

  async function requestTaskAiAssist() {
    if (taskTitle.trim().length < 3) {
      setActionMessage('AI önerisi için görev başlığı en az 3 karakter olmalı.');
      return;
    }

    setIsGeneratingTaskAssist(true);
    setActionMessage(null);

    try {
      const response = await fetch('/api/dashboard/cases/tasks/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: taskModal?.mode === 'bulk' ? undefined : resolvedTaskCaseId || undefined,
          title: taskTitle.trim(),
          description: taskDescription.trim() || undefined,
          taskType,
          deadlineType: taskDeadlineType,
          dueAt: taskDueAt ? new Date(taskDueAt).toISOString() : undefined,
        }),
      });

      const payload = (await response.json()) as { suggestion?: TaskAiAssistPayload; error?: string };

      if (!response.ok || !payload.suggestion) {
        setActionMessage(payload.error ?? 'AI görev önerisi alınamadı.');
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
      setTaskEntryMode('smart');
    } catch {
      setActionMessage('AI önerisi alınırken hata oluştu.');
    } finally {
      setIsGeneratingTaskAssist(false);
    }
  }

  function toggleCaseSelection(caseId: string) {
    setSelectedCaseIds((previous) =>
      previous.includes(caseId) ? previous.filter((id) => id !== caseId) : [...previous, caseId]
    );
  }

  function toggleSelectAllFiltered() {
    if (allFilteredSelected) {
      setSelectedCaseIds((previous) => previous.filter((id) => !filteredCases.some((item) => item.id === id)));
      return;
    }

    setSelectedCaseIds((previous) => {
      const set = new Set(previous);
      filteredCases.forEach((item) => set.add(item.id));
      return [...set];
    });
  }

  async function applyStatusUpdate(caseIds: string[], status: CaseStatus) {
    if (caseIds.length === 0) {
      setActionMessage('Önce en az bir dosya seçin.');
      return;
    }

    setIsApplyingAction(true);
    setActionMessage(null);
    setActionLink(null);

    try {
      const response = await fetch('/api/dashboard/cases/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseIds, status }),
      });

      const payload = (await response.json()) as { updatedCount?: number; error?: string };
      if (!response.ok) {
        setActionMessage(payload.error ?? 'Durum güncellemesi yapılamadı.');
        return;
      }

      setActionMessage(`${payload.updatedCount ?? caseIds.length} dosya güncellendi.`);
      setSelectedCaseIds([]);
      await refetch();
    } catch {
      setActionMessage('Durum güncellemesi sırasında beklenmeyen hata oluştu.');
    } finally {
      setIsApplyingAction(false);
    }
  }

  function getPreferredTaskAssigneeId(): string {
    const currentUser = teamMembers.find((member) => member.isCurrentUser);
    return currentUser?.id ?? teamMembers[0]?.id ?? '';
  }

  function openGeneralTaskModal() {
    const preferredCase = filteredCases[0];
    const defaultAssigneeId = getPreferredTaskAssigneeId();
    resetTaskDraft({ assigneeId: defaultAssigneeId, mode: 'smart' });
    setTaskModal({
      mode: 'general',
      caseId: preferredCase?.id,
      caseTitle: preferredCase?.title,
    });
    setTaskCaseId(preferredCase?.id ?? '');
    setTaskTitle(preferredCase?.title ? `${preferredCase.title} - Takip Görevi` : 'Takip Görevi');
    if (preferredCase?.id) {
      loadTaskCaseDocuments(preferredCase.id).catch(() => {
        setActionMessage('Görev için dosya belgeleri yüklenemedi.');
      });
    }
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

    openGeneralTaskModal();

    const nextParams = new URLSearchParams(currentSearch);
    nextParams.delete('openTask');
    const nextSearch = nextParams.toString();
    router.replace((nextSearch ? `${pathname}?${nextSearch}` : pathname) as Route, { scroll: false });
  }, [pathname, router, searchParams]);

  async function handleCreateCaseTask(caseId: string, caseTitle: string) {
    const defaultAssigneeId = getPreferredTaskAssigneeId();
    resetTaskDraft({ assigneeId: defaultAssigneeId, mode: 'quick' });
    setTaskModal({ mode: 'single', caseId, caseTitle });
    setTaskCaseId(caseId);
    setTaskTitle(`${caseTitle} - Takip Görevi`);
    await loadTaskCaseDocuments(caseId);
  }

  async function submitTask() {
    if (!taskModal || taskTitle.trim().length < 3) {
      setActionMessage('Görev başlangıcı en az 3 karakter olmalı.');
      return;
    }

    if (taskModal.mode !== 'bulk' && !resolvedTaskCaseId) {
      setActionMessage('Görev için dosya seçimi zorunludur.');
      return;
    }

    if (taskModal.mode === 'bulk' && selectedCaseIds.length === 0) {
      setActionMessage('Toplu görev için önce en az bir dosya seçin.');
      return;
    }

    setIsApplyingAction(true);
    setActionMessage(null);
    setActionLink(null);

    try {
      const endpoint = taskModal.mode === 'bulk' ? '/api/dashboard/cases/tasks/bulk' : '/api/dashboard/cases/tasks';
      const body =
        taskModal.mode === 'bulk'
          ? {
              caseIds: selectedCaseIds,
              title: taskTitle.trim(),
              priority: taskPriority,
              dueAt: taskDueAt ? new Date(taskDueAt).toISOString() : undefined,
              assignedTo: taskAssignedTo || undefined,
            }
          : {
              caseId: resolvedTaskCaseId,
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
            };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as { error?: string; createdCount?: number };
      if (!response.ok) {
        setActionMessage(payload.error ?? 'Görev oluşturulamadı.');
        return;
      }

      setActionMessage(
        taskModal.mode === 'bulk'
          ? `${payload.createdCount ?? selectedCaseIds.length} dosya için görev oluşturuldu.`
          : 'Dosya için görev oluşturuldu.'
      );
      setActionLink({ href: '/dashboard/tasks', label: 'Gorevler sayfasina git' });
      setTaskModal(null);
      resetTaskDraft({ assigneeId: getPreferredTaskAssigneeId(), mode: 'quick' });
      if (taskModal.mode === 'bulk') {
        setSelectedCaseIds([]);
      }
      await refetch();
    } catch {
      setActionMessage('Görev oluşturulurken hata oluştu.');
    } finally {
      setIsApplyingAction(false);
    }
  }

  async function submitCreateCase() {
    if (newCaseTitle.trim().length < 3) {
      setActionMessage('Dosya başlığı en az 3 karakter olmalı.');
      return;
    }

    if (createInitialTask && initialTaskTitle.trim().length < 3) {
      setActionMessage('İlk görev başlığı en az 3 karakter olmalı. ');
      return;
    }

    setIsApplyingAction(true);
    setActionMessage(null);
    setActionLink(null);

    try {
      const computedTitle = buildCaseDisplayTitle(newCaseTitle, { tag: newCaseTag });

      const response = await fetch('/api/dashboard/cases/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: computedTitle,
          status: newCaseStatus,
          clientId: newCaseClientIds[0] || undefined,
          clientIds: newCaseClientIds.length > 0 ? newCaseClientIds : undefined,
          lawyerId: newCaseLawyerId || undefined,
          autoCode: newCaseIncludeAutoCode,
          caseCode: !newCaseIncludeAutoCode ? undefined : null,
          tags: newCaseTag.trim() ? [newCaseTag.trim()] : [],
          clientDetails: {
            fullName: clientDetailFullName.trim() || undefined,
            tcIdentity: clientDetailTcIdentity.trim() || undefined,
            contactName: clientDetailContactName.trim() || undefined,
            email: clientDetailEmail.trim() || undefined,
            phone: clientDetailPhone.trim() || undefined,
            fileNo: clientDetailFileNo.trim() || undefined,
            partyType: clientDetailPartyType || undefined,
          },
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        case?: { id: string; title: string; caseCode?: string | null };
        clientCandidateCreated?: boolean;
      };

      if (!response.ok) {
        setActionMessage(payload.error ?? 'Dosya oluşturulamadı.');
        return;
      }

      let initialTaskErrorMessage: string | null = null;

      if (createInitialTask && payload.case?.id) {
        const taskResponse = await fetch('/api/dashboard/cases/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caseId: payload.case.id,
            title: initialTaskTitle.trim(),
            priority: initialTaskPriority,
            dueAt: initialTaskDueAt ? new Date(initialTaskDueAt).toISOString() : undefined,
            assignedTo: initialTaskAssignedTo || newCaseLawyerId || undefined,
          }),
        });

        if (!taskResponse.ok) {
          const taskPayload = (await taskResponse.json()) as { error?: string };
          initialTaskErrorMessage = taskPayload.error ?? 'Dosya oluştu fakat ilk görev oluşturulamadı.';
        }
      }

      setActionMessage(
        initialTaskErrorMessage
          ? `Yeni dosya oluşturuldu ancak ilk görev açılamadı: ${initialTaskErrorMessage}`
          : payload.clientCandidateCreated
            ? 'Yeni dosya oluşturuldu. Müvekkil detayıyla bir müvekkil adayı kaydedildi.'
            : 'Yeni dosya başarıyla oluşturuldu.'
      );
      if (payload.case?.id) {
        setActionLink({ href: `/dashboard/cases/${payload.case.id}`, label: 'Yeni dosyaya git' });
      }
      setCreateCaseModalOpen(false);
      setCreateCaseStep(1);
      setNewCaseTitle('');
      setNewCaseStatus('open');
      setNewCaseClientIds([]);
      setNewCaseClientDisplay('');
      setClientSearch('');
      setClientInviteFormOpen(false);
      setClientInviteFullName('');
      setClientInviteEmail('');
      setClientInviteUsername('');
      setClientDetailFullName('');
      setClientDetailTcIdentity('');
      setClientDetailContactName('');
      setClientDetailEmail('');
      setClientDetailPhone('');
      setClientDetailFileNo('');
      setClientDetailPartyType('');
      setNewCaseLawyerId('');
      setNewCaseTag('');
      setNewCaseIncludeAutoCode(true);
      setCreateInitialTask(false);
      setInitialTaskTitle('İlk Dosya Takip Görevi');
      setInitialTaskPriority('normal');
      setInitialTaskDueAt('');
      setInitialTaskAssignedTo('');
      setPage(1);
      const refreshResult = await refetch();
      if (refreshResult.error) {
        setActionMessage('Dosya oluşturuldu. Liste yenilenemedi, sayfayı yenileyin.');
      }
    } catch {
      setActionMessage('Dosya oluşturulurken hata oluştu.');
    } finally {
      setIsApplyingAction(false);
    }
  }

  function selectClientFromDirectory(item: ClientDirectoryItem) {
    const label = item.fullName || item.email || 'İsimsiz müvekkil';

    if (item.type !== 'client' || !item.clientId) {
      setActionMessage('Seçilen kayıt davet adayı. Dosyaya atama için kayıt tamamlandığında sonra müvekkil profilini seçin. ');
      setNewCaseClientIds([]);
      setNewCaseClientDisplay(label);
      setClientSearch(label);
      return;
    }

    setNewCaseClientIds((previous) => (previous.includes(item.clientId as string) ? previous : [...previous, item.clientId as string]));
    setActionMessage(null);
    setNewCaseClientDisplay(label);
    setClientSearch(label);
    setClientInviteFormOpen(false);
  }

  async function submitClientInviteFromCases() {
    if (clientInviteFullName.trim().length < 3) {
      setActionMessage('Müvekkil adı en az 3 karakter olmalı.');
      return;
    }

    if (clientInviteEmail.trim().length < 5) {
      setActionMessage('Müvekkil daveti için geçerli e-posta girin.');
      return;
    }

    if (!isClientInviteUsernameValid) {
      setActionMessage('Kullanıcı adı sadece a-z, 0-9, . ve _ içerebilir; girildiyse en az 3 karakter olmalı.');
      return;
    }

    setIsApplyingAction(true);
    setActionMessage(null);

    try {
      const response = await fetch('/api/dashboard/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: clientInviteFullName.trim(),
          email: clientInviteEmail.trim(),
          username: normalizedClientInviteUsername || undefined,
          expiresInDays: 7,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setActionMessage(payload.error ?? 'Müvekkil daveti oluşturulamadı.');
        return;
      }

      setActionMessage('Müvekkil daveti oluşturuldu. Kayıt tamamlanınca dosyaya atanabilir.');
      setNewCaseClientIds([]);
      setNewCaseClientDisplay(clientInviteFullName.trim());
      setClientSearch(clientInviteFullName.trim());
      setClientInviteFormOpen(false);
      setClientInviteFullName('');
      setClientInviteEmail('');
      setClientInviteUsername('');
      await refetchClientDirectory();
    } catch {
      setActionMessage('Müvekkil daveti oluşturulurken hata oluştu.');
    } finally {
      setIsApplyingAction(false);
    }
  }

  async function submitQuickNote() {
    if (!noteModalCase || noteText.trim().length < 3) {
      setActionMessage('Not metni en az 3 karakter olmalı.');
      return;
    }

    setIsApplyingAction(true);
    setActionMessage(null);
    setActionLink(null);

    try {
      const response = await fetch('/api/dashboard/cases/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: noteModalCase.id,
          message: noteText.trim(),
          isPublicToClient: notePublic,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setActionMessage(payload.error ?? 'Not eklenemedi.');
        return;
      }

      setActionMessage('Dosya notu kaydedildi.');
      setNoteText('');
      setNotePublic(false);
      if (noteModalCase) {
        await loadCaseNotes(noteModalCase.id);
      }
      await refetch();
    } catch {
      setActionMessage('Not kaydı sırasında hata oluştu.');
    } finally {
      setIsApplyingAction(false);
    }
  }

  async function loadCaseNotes(caseId: string) {
    setIsLoadingNoteHistory(true);

    try {
      const response = await fetch(`/api/dashboard/cases/notes?caseId=${encodeURIComponent(caseId)}`, { cache: 'no-store' });
      const payload = (await response.json()) as { notes?: CaseNoteItem[]; error?: string };

      if (!response.ok) {
        setActionMessage(payload.error ?? 'Not geçmişi alınamadı.');
        setNoteHistory([]);
        return;
      }

      setNoteHistory(payload.notes ?? []);
    } catch {
      setActionMessage('Not geçmişi yüklenirken hata oluştu.');
      setNoteHistory([]);
    } finally {
      setIsLoadingNoteHistory(false);
    }
  }

  useEffect(() => {
    if (!noteModalCase) {
      setNoteHistory([]);
      return;
    }

    loadCaseNotes(noteModalCase.id).catch(() => {
      setActionMessage('Not geçmişi yüklenirken hata oluştu.');
    });
  }, [noteModalCase]);

  useEffect(() => {
    setSelectedCaseIds([]);
  }, [query, statusFilter, quickView, sortBy, page, pageSize]);

  useEffect(() => {
    if (teamMembers.length === 0 || taskAssignedTo) {
      return;
    }

    const currentUser = teamMembers.find((member) => member.isCurrentUser);
    setTaskAssignedTo(currentUser?.id ?? teamMembers[0]?.id ?? '');
  }, [teamMembers, taskAssignedTo]);

  useEffect(() => {
    if (!caseFormMeta || newCaseLawyerId) {
      return;
    }

    const currentLawyer = caseFormMeta.lawyers.find((lawyer) =>
      teamMembers.some((member) => member.id === lawyer.id && member.isCurrentUser)
    );
    setNewCaseLawyerId(currentLawyer?.id ?? caseFormMeta.lawyers[0]?.id ?? '');
  }, [caseFormMeta, newCaseLawyerId, teamMembers]);

  useEffect(() => {
    if (!initialTaskAssignedTo && newCaseLawyerId) {
      setInitialTaskAssignedTo(newCaseLawyerId);
    }
  }, [initialTaskAssignedTo, newCaseLawyerId]);

  const selectedClientNames = newCaseClientIds.map((selectedId) => {
    const fromMeta = caseFormMeta?.clients.find((item) => item.id === selectedId)?.fullName;
    const fromDirectory = clientDirectory.find((item) => item.type === 'client' && item.clientId === selectedId)?.fullName;
    return fromMeta ?? fromDirectory ?? selectedId;
  });
  const selectedClientSummaryName = selectedClientNames.length > 0 ? selectedClientNames.join(', ') : clientDetailFullName.trim();

  return (
    <div className="space-y-4 text-[var(--text)] font-sans" style={{ fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif' }}>
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <CardTitle>Dosya Yönetimi</CardTitle>
              <p className="text-sm text-slate-500">Dosyaları durum, müvekkil ve başlığa göre filtreleyin.</p>
              <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1">
                <Link href={'/dashboard/clients' as Route}>
                  <span className="inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
                    Müvekkiller
                  </span>
                </Link>
                <Link href={'/dashboard/cases' as Route}>
                  <span className="inline-flex h-8 items-center rounded-full bg-slate-900 px-3 text-xs font-semibold text-white">
                    Dosyalar
                  </span>
                </Link>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={openGeneralTaskModal}
                className="h-11 rounded-xl border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-100"
              >
                + Görev Ekle
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setCreateCaseModalOpen(true);
                  setCreateCaseStep(1);
                  setNewCaseClientIds([]);
                  setNewCaseClientDisplay('');
                  setClientSearch('');
                  setClientInviteFormOpen(false);
                  setClientInviteFullName('');
                  setClientInviteEmail('');
                  setClientInviteUsername('');
                  setClientDetailFullName('');
                  setClientDetailTcIdentity('');
                  setClientDetailContactName('');
                  setClientDetailEmail('');
                  setClientDetailPhone('');
                  setClientDetailFileNo('');
                  setClientDetailPartyType('');
                  if (!newCaseLawyerId) {
                    const currentLawyer = caseFormMeta?.lawyers.find((lawyer) =>
                      teamMembers.some((member) => member.id === lawyer.id && member.isCurrentUser)
                    );
                    setNewCaseLawyerId(currentLawyer?.id ?? caseFormMeta?.lawyers[0]?.id ?? '');
                  }
                }}
                className="h-11 rounded-xl bg-gradient-to-r from-blue-600 to-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-slate-950"
              >
                + Gelişmiş Dosya Ekle
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <p className="text-xs text-slate-500">Toplam Dosya</p>
              <p className="text-xl font-semibold text-slate-900">{isLoading ? '...' : stats.total}</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              <p className="text-xs text-blue-700">Açık</p>
              <p className="text-xl font-semibold text-blue-900">{isLoading ? '...' : stats.open}</p>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm">
              <p className="text-xs text-orange-700">İlerliyor</p>
              <p className="text-xl font-semibold text-orange-900">{isLoading ? '...' : stats.inProgress}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <p className="text-xs text-slate-600">Kapalı / Arşiv</p>
              <p className="text-xl font-semibold text-slate-900">{isLoading ? '...' : stats.closed + stats.archived}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <Input
              placeholder="Dosya veya müvekkil adına göre ara"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as 'all' | CaseStatus);
                  setPage(1);
                }}
                className="h-10 rounded-md border border-input bg-white px-3 text-sm"
              >
                <option value="all">Tüm durumlar</option>
                <option value="open">Açık</option>
                <option value="in_progress">İlerliyor</option>
                <option value="closed">Kapalı</option>
                <option value="archived">Arşiv</option>
              </select>
              <select
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value as 'updated_desc' | 'updated_asc' | 'title_asc');
                  setPage(1);
                }}
                className="h-10 rounded-md border border-input bg-white px-3 text-sm"
              >
                <option value="updated_desc">Yeni güncelleme</option>
                <option value="updated_asc">Eski güncelleme</option>
                <option value="title_asc">Ada göre</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setQuickView('all');
                setPage(1);
              }}
              className={quickView === 'all' ? 'rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white' : 'rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-slate-700'}
            >
              Tüm Dosyalar
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickView('open');
                setPage(1);
              }}
              className={quickView === 'open' ? 'rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white' : 'rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-slate-700'}
            >
              Açıklar
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickView('active');
                setPage(1);
              }}
              className={quickView === 'active' ? 'rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white' : 'rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-slate-700'}
            >
              Aktif Süreç
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickView('updated_this_week');
                setPage(1);
              }}
              className={quickView === 'updated_this_week' ? 'rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white' : 'rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-slate-700'}
            >
              Bu Hafta Güncellenen
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickView('high_risk');
                setPage(1);
              }}
              className={quickView === 'high_risk' ? 'rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white' : 'rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium text-slate-700'}
            >
              Yüksek Risk (10+ gün)
            </button>
          </div>

          {selectedCaseIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2">
              <p className="text-xs font-medium text-orange-800">{selectedCaseIds.length} dosya seçildi</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isApplyingAction}
                onClick={() => applyStatusUpdate(selectedCaseIds, 'in_progress')}
              >
                Toplu İlerlet
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isApplyingAction}
                onClick={() => applyStatusUpdate(selectedCaseIds, 'closed')}
              >
                Toplu Kapat
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isApplyingAction}
                onClick={() => applyStatusUpdate(selectedCaseIds, 'open')}
              >
                Toplu Açık Yap
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isApplyingAction}
                onClick={() => {
                  resetTaskDraft({ assigneeId: getPreferredTaskAssigneeId(), mode: 'quick' });
                  setTaskModal({ mode: 'bulk' });
                  setTaskTitle('Toplu Takip Görevi');
                }}
              >
                Toplu Görev Aç
              </Button>
            </div>
          ) : null}

          {actionMessage ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span>{actionMessage}</span>
              {actionLink ? (
                <a href={actionLink.href} className="font-medium text-blue-600 hover:underline">
                  {actionLink.label}
                </a>
              ) : null}
            </div>
          ) : null}

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : isError ? (
            <p className="text-sm text-orange-600">{error instanceof Error ? error.message : 'Dosya listesi alınamadı.'}</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left">
                    <tr>
                      <th className="px-4 py-3">
                        <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAllFiltered} />
                      </th>
                      <th className="px-4 py-3">Dosya Adı</th>
                      <th className="px-4 py-3">Müvekkil</th>
                      <th className="px-4 py-3">Durum</th>
                      <th className="px-4 py-3">Risk / SLA</th>
                      <th className="px-4 py-3">Son Güncelleme</th>
                      <th className="px-4 py-3">Hızlı Aksiyon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCases.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                          Filtreye uygun dosya bulunamadı.
                        </td>
                      </tr>
                    ) : (
                      filteredCases.map((item) => (
                        <tr key={item.id} className="border-t border-border hover:bg-slate-50/60">
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedCaseIds.includes(item.id)}
                              onChange={() => toggleCaseSelection(item.id)}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/dashboard/cases/${item.id}` as Route}
                              className="font-medium text-blue-600 hover:underline"
                            >
                              {item.title}
                            </Link>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {item.lastNoteAt ? (
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600" suppressHydrationWarning>
                                  Son Not: {formatDateTR(item.lastNoteAt)}
                                </span>
                              ) : null}
                              {item.lastTaskAt ? (
                                <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700" suppressHydrationWarning>
                                  Son Görev: {formatDateTR(item.lastTaskAt)}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {item.clients && item.clients.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {item.clients.map((client) => (
                                  <Link
                                    key={`${item.id}-${client.id}`}
                                    href={`/dashboard/clients/${client.id}` as Route}
                                    className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:underline"
                                  >
                                    {client.fullName}
                                  </Link>
                                ))}
                              </div>
                            ) : (
                              item.clientName
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={getStatusVariant(item.status)}>{getStatusLabel(item.status)}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={getActivityRisk(item.updatedAt).variant}>{getActivityRisk(item.updatedAt).label}</Badge>
                          </td>
                          <td className="px-4 py-3" suppressHydrationWarning>
                            {formatDateTR(item.updatedAt)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={isApplyingAction || isFetching}
                                onClick={() => applyStatusUpdate([item.id], 'in_progress')}
                              >
                                İlerlet
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={isApplyingAction || isFetching}
                                onClick={() => applyStatusUpdate([item.id], 'closed')}
                              >
                                Kapat
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={isApplyingAction || isFetching}
                                onClick={() => {
                                  handleCreateCaseTask(item.id, item.title).catch(() => {
                                    setActionMessage('Görev formu oluşturulamadı.');
                                  });
                                }}
                              >
                                Görev
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={isApplyingAction || isFetching}
                                onClick={() => {
                                  setNoteModalCase({ id: item.id, title: item.title });
                                  setNoteText('');
                                  setNotePublic(false);
                                }}
                              >
                                Not
                              </Button>
                              <Link href={'/office' as Route} className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-muted">
                                Mesaj
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div>
                  Sayfa {pagination.page} / {pagination.totalPages} · Toplam {pagination.total} kayıt
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      setPage(1);
                    }}
                    className="h-8 rounded-md border border-input bg-white px-2 text-xs"
                  >
                    <option value={20}>20 / sayfa</option>
                    <option value={50}>50 / sayfa</option>
                    <option value={100}>100 / sayfa</option>
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isFetching || pagination.page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Önceki
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isFetching || pagination.page >= pagination.totalPages}
                    onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
                  >
                    Sonraki
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {noteModalCase ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Hızlı Not Ekle</h3>
            <p className="mt-1 text-sm text-slate-600">{noteModalCase.title}</p>

            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              placeholder="Dosya için kısa notunuzu yazın..."
              className="mt-3 min-h-28 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
            />

            <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={notePublic} onChange={(event) => setNotePublic(event.target.checked)} />
              Müvekkile görünür not olarak işaretle
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNoteModalCase(null);
                  setNoteText('');
                  setNotePublic(false);
                }}
              >
                Vazgeç
              </Button>
              <Button type="button" disabled={isApplyingAction || noteText.trim().length < 3} onClick={submitQuickNote}>
                Kaydet
              </Button>
            </div>

            <div className="mt-4 border-t border-slate-200 pt-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Son Notlar</p>
              {isLoadingNoteHistory ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : noteHistory.length === 0 ? (
                <p className="text-xs text-slate-500">Bu dosya için kayıtlı not bulunmuyor.</p>
              ) : (
                <ul className="max-h-40 space-y-2 overflow-y-auto text-xs">
                  {noteHistory.map((note) => (
                    <li key={note.id} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                      <p className="text-slate-700">{note.message}</p>
                      <p className="mt-1 text-[11px] text-slate-500" suppressHydrationWarning>
                        {formatDateTR(note.created_at)} · {note.is_public_to_client ? 'Müvekkil görünür' : 'Dahili'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {createCaseModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl flex flex-col">
            <h3 className="text-base font-semibold text-slate-900">Gelişmiş Dosya Ekle</h3>
            <p className="mt-1 text-sm text-slate-600">Başlık, durum, atama ve onay adımlarıyla yeni dosya oluşturun.</p>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setCreateCaseStep(1)}
                className={createCaseStep === 1 ? 'rounded-md border border-blue-200 bg-blue-50 px-2 py-2 text-xs font-semibold text-blue-700' : 'rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600'}
              >
                1) Başlık
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newCaseTitle.trim().length < 3) {
                    setActionMessage('Önce dosya başlığını girin.');
                    return;
                  }
                  setCreateCaseStep(2);
                }}
                className={createCaseStep === 2 ? 'rounded-md border border-blue-200 bg-blue-50 px-2 py-2 text-xs font-semibold text-blue-700' : 'rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600'}
              >
                2) Atama
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newCaseTitle.trim().length < 3) {
                    setActionMessage('Önce başlık adımını tamamlayın.');
                    return;
                  }
                  setCreateCaseStep(3);
                }}
                className={createCaseStep === 3 ? 'rounded-md border border-blue-200 bg-blue-50 px-2 py-2 text-xs font-semibold text-blue-700' : 'rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-medium text-slate-600'}
              >
                3) Onay
              </button>
            </div>

            <div className="mt-3 space-y-3">
              {createCaseStep === 1 ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Hızlı Şablonlar</label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        onClick={() => {
                          setNewCaseTitle('İcra Takibi - Yeni Dosya');
                          setNewCaseStatus('open');
                        }}
                      >
                        İcra Takibi
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        onClick={() => {
                          setNewCaseTitle('Sözleşme Uyuşmazlığı - Yeni Dosya');
                          setNewCaseStatus('in_progress');
                        }}
                      >
                        Sözleşme Uyuşmazlığı
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        onClick={() => {
                          setNewCaseTitle('Dava Ön İnceleme - Yeni Dosya');
                          setNewCaseStatus('open');
                        }}
                      >
                        Dava Ön İnceleme
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Dosya Başlığı</label>
                    <Input
                      value={newCaseTitle}
                      onChange={(event) => setNewCaseTitle(event.target.value)}
                      placeholder="Örn: Ahmet Yılmaz - İş Hukuku Davası"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Etiket (Opsiyonel)</label>
                      <Input
                        value={newCaseTag}
                        onChange={(event) => setNewCaseTag(event.target.value)}
                        placeholder="Örn: İş Hukuku"
                      />
                    </div>
                    <label className="mt-6 flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={newCaseIncludeAutoCode}
                        onChange={(event) => setNewCaseIncludeAutoCode(event.target.checked)}
                      />
                      Otomatik dosya kodu ekle
                    </label>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Durum</label>
                    <select
                      value={newCaseStatus}
                      onChange={(event) => setNewCaseStatus(event.target.value as CaseStatus)}
                      className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                    >
                      <option value="open">Açık</option>
                      <option value="in_progress">İlerliyor</option>
                      <option value="closed">Kapalı</option>
                      <option value="archived">Arşiv</option>
                    </select>
                  </div>
                </>
              ) : null}

              {createCaseStep === 2 ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Avukat</label>
                      <select
                        value={newCaseLawyerId}
                        onChange={(event) => setNewCaseLawyerId(event.target.value)}
                        className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                      >
                        <option value="">Atanmamış (otomatik)</option>
                        {(caseFormMeta?.lawyers ?? []).map((lawyer) => (
                          <option key={lawyer.id} value={lawyer.id}>
                            {lawyer.fullName ?? 'İsimsiz kullanıcı'}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Müvekkil Ara / Seç</label>
                      <Input
                        value={clientSearch}
                        onChange={(event) => setClientSearch(event.target.value)}
                        placeholder="Ad soyad, kullanıcı adı veya e-posta"
                      />
                    </div>
                  </div>

                  {newCaseClientIds.length > 0 || newCaseClientDisplay ? (
                    <p className="text-xs text-slate-600">
                      Seçili müvekkil(ler):{' '}
                      <span className="font-medium text-slate-800">
                        {selectedClientNames.length > 0 ? selectedClientNames.join(', ') : newCaseClientDisplay}
                      </span>
                    </p>
                  ) : null}

                  <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
                    {clientDirectory.length === 0 ? (
                      <p className="text-slate-500">Eşleşen müvekkil bulunamadı. Müvekkil seçimi opsiyoneldir; bu adımı geçebilir veya isterseniz davet oluşturabilirsiniz.</p>
                    ) : (
                      <ul className="space-y-1">
                        {clientDirectory.slice(0, 10).map((item) => (
                          <li key={`${item.type}-${item.id}`}>
                            {item.type === 'client' ? (
                            <button
                              type="button"
                              onClick={() => selectClientFromDirectory(item)}
                              className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-1 text-left hover:bg-slate-100"
                            >
                              <span className="text-slate-700">
                                {item.fullName ?? item.email ?? 'İsimsiz müvekkil'}
                                {item.username ? ` · @${item.username}` : ''}
                              </span>
                              <Badge variant={item.type === 'client' ? 'blue' : 'orange'}>
                                {item.type === 'client' ? 'Kayıtlı' : 'Davet'}
                              </Badge>
                            </button>
                            ) : (
                              <div className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-left opacity-80">
                                <span className="text-slate-700">
                                  {item.fullName ?? item.email ?? 'İsimsiz müvekkil'}
                                  {item.username ? ` · @${item.username}` : ''}
                                </span>
                                <Badge variant="orange">Davet (atanamaz)</Badge>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {newCaseClientIds.length > 0 ? (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setNewCaseClientIds([]);
                          setNewCaseClientDisplay('');
                          setClientSearch('');
                        }}
                      >
                        Müvekkil Atamasını Kaldır
                      </Button>
                    </div>
                  ) : null}

                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Müvekkil Ekle</p>
                      <Button type="button" size="sm" variant="outline" onClick={() => setClientInviteFormOpen((value) => !value)}>
                        {clientInviteFormOpen ? 'Kapat' : 'Davet Formu Aç'}
                      </Button>
                    </div>

                    {clientInviteFormOpen ? (
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <div className="md:col-span-2">
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Ad Soyad</label>
                          <Input value={clientInviteFullName} onChange={(event) => setClientInviteFullName(event.target.value)} placeholder="Örn: Ahmet Yılmaz" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">E-Posta</label>
                          <Input value={clientInviteEmail} onChange={(event) => setClientInviteEmail(event.target.value)} placeholder="ornek@domain.com" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Kullanıcı Adı (Opsiyonel)</label>
                          <Input
                            value={clientInviteUsername}
                            onChange={(event) => setClientInviteUsername(event.target.value.toLowerCase())}
                            placeholder="ahmety"
                          />
                          {isClientInviteUsernameProvided && !isClientInviteUsernameValid ? (
                            <p className="mt-1 text-xs text-orange-600">Sadece a-z, 0-9, . ve _ kullanın; minimum 3 karakter.</p>
                          ) : null}
                        </div>
                        <div className="md:col-span-2 flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            disabled={isApplyingAction || clientInviteFullName.trim().length < 3 || clientInviteEmail.trim().length < 5 || !isClientInviteUsernameValid}
                            onClick={submitClientInviteFromCases}
                          >
                            Müvekkil Daveti Oluştur
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">Yeni müvekkil için ad soyad ve e-posta ile davet oluşturabilirsiniz.</p>
                    )}
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Müvekkil Detayları (Opsiyonel)</p>
                    <p className="mb-3 text-xs text-slate-500">Müvekkil ataması yapmadan da bu alanları doldurabilirsiniz. E-posta girilirse müvekkil adayı olarak da kaydedilir.</p>

                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Ad Soyad</label>
                        <Input value={clientDetailFullName} onChange={(event) => setClientDetailFullName(event.target.value)} placeholder="Örn: Ayşe Kaya" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">TC / VKN</label>
                        <Input value={clientDetailTcIdentity} onChange={(event) => setClientDetailTcIdentity(event.target.value)} placeholder="Örn: 12345678901" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">İletişim Kişisi</label>
                        <Input value={clientDetailContactName} onChange={(event) => setClientDetailContactName(event.target.value)} placeholder="Örn: Ali Kaya" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">E-Posta</label>
                        <Input value={clientDetailEmail} onChange={(event) => setClientDetailEmail(event.target.value)} placeholder="ornek@domain.com" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Telefon</label>
                        <Input value={clientDetailPhone} onChange={(event) => setClientDetailPhone(event.target.value)} placeholder="Örn: 05xx xxx xx xx" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Dosya No</label>
                        <Input value={clientDetailFileNo} onChange={(event) => setClientDetailFileNo(event.target.value)} placeholder="Örn: 2026/145" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Taraf Tipi</label>
                        <select
                          value={clientDetailPartyType}
                          onChange={(event) => setClientDetailPartyType(event.target.value as '' | 'plaintiff' | 'defendant' | 'consultant')}
                          className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                        >
                          <option value="">Belirtilmedi</option>
                          <option value="plaintiff">Davacı</option>
                          <option value="defendant">Davalı</option>
                          <option value="consultant">Danışan</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {createCaseStep === 3 ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <p className="font-medium text-slate-900">Özet</p>
                    <ul className="mt-2 space-y-1">
                      <li>
                        <span className="text-slate-500">Dosya Kodu:</span> {newCaseIncludeAutoCode ? 'Otomatik üretilecek' : 'Yok'}
                      </li>
                      <li>
                        <span className="text-slate-500">Oluşacak Başlık:</span>{' '}
                        {buildCaseDisplayTitle(newCaseTitle, { tag: newCaseTag }) || '-'}
                      </li>
                      <li>
                        <span className="text-slate-500">Durum:</span> {getStatusLabel(newCaseStatus)}
                      </li>
                      <li>
                        <span className="text-slate-500">Avukat:</span>{' '}
                        {caseFormMeta?.lawyers.find((item) => item.id === newCaseLawyerId)?.fullName ?? 'Atanmamış (otomatik)'}
                      </li>
                      <li>
                        <span className="text-slate-500">Müvekkil:</span>{' '}
                        {selectedClientSummaryName || 'Atanmamış'}
                      </li>
                      <li>
                        <span className="text-slate-500">Opsiyonel Müvekkil Detayı:</span>{' '}
                        {hasOptionalClientDetails
                          ? clientDetailEmail.trim().length > 0
                            ? 'Girildi (iç not + müvekkil adayı)'
                            : 'Girildi (iç not)'
                          : 'Yok'}
                      </li>
                    </ul>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <label className="flex items-center gap-2 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        checked={createInitialTask}
                        onChange={(event) => setCreateInitialTask(event.target.checked)}
                      />
                      Dosyayla birlikte ilk görev oluştur
                    </label>

                    {createInitialTask ? (
                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        <div className="md:col-span-2">
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">İlk Görev Başlığı</label>
                          <Input value={initialTaskTitle} onChange={(event) => setInitialTaskTitle(event.target.value)} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Öncelik</label>
                          <select
                            value={initialTaskPriority}
                            onChange={(event) => setInitialTaskPriority(event.target.value as 'low' | 'normal' | 'high')}
                            className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                          >
                            <option value="low">Düşük</option>
                            <option value="normal">Normal</option>
                            <option value="high">Yüksek</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Atanan</label>
                          <select
                            value={initialTaskAssignedTo}
                            onChange={(event) => setInitialTaskAssignedTo(event.target.value)}
                            className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                          >
                            <option value="">Otomatik (dosya ataması)</option>
                            {(caseFormMeta?.lawyers ?? []).map((lawyer) => (
                              <option key={lawyer.id} value={lawyer.id}>
                                {lawyer.fullName ?? 'İsimsiz kullanıcı'}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="md:col-span-2">
                          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Bitiş Tarihi</label>
                          <Input type="datetime-local" value={initialTaskDueAt} onChange={(event) => setInitialTaskDueAt(event.target.value)} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap justify-between gap-2">
              <div className="flex gap-2">
                {createCaseStep > 1 ? (
                  <Button type="button" variant="outline" onClick={() => setCreateCaseStep((current) => (current === 3 ? 2 : 1))}>
                    Geri
                  </Button>
                ) : null}
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCreateCaseModalOpen(false);
                    setCreateCaseStep(1);
                    setNewCaseTitle('');
                    setNewCaseStatus('open');
                    setNewCaseClientIds([]);
                    setNewCaseClientDisplay('');
                    setClientSearch('');
                    setClientInviteFormOpen(false);
                    setClientInviteFullName('');
                    setClientInviteEmail('');
                    setClientInviteUsername('');
                    setClientDetailFullName('');
                    setClientDetailTcIdentity('');
                    setClientDetailContactName('');
                    setClientDetailEmail('');
                    setClientDetailPhone('');
                    setClientDetailFileNo('');
                    setClientDetailPartyType('');
                    setNewCaseLawyerId('');
                    setNewCaseTag('');
                    setNewCaseIncludeAutoCode(true);
                    setCreateInitialTask(false);
                    setInitialTaskTitle('ilk Dosya Takip Görevi');
                    setInitialTaskPriority('normal');
                    setInitialTaskDueAt('');
                    setInitialTaskAssignedTo('');
                  }}
                >
                  Vazgeç
                </Button>

                {createCaseStep < 3 ? (
                  <Button
                    type="button"
                    onClick={() => {
                      if (createCaseStep === 1 && newCaseTitle.trim().length < 3) {
                        setActionMessage('Dosya başlığı en az 3 karakter olmalı.');
                        return;
                      }

                      setCreateCaseStep((current) => (current === 1 ? 2 : 3));
                    }}
                  >
                    Devam
                  </Button>
                ) : (
                  <Button type="button" disabled={isApplyingAction || newCaseTitle.trim().length < 3} onClick={submitCreateCase}>
                    Dosyayı Oluştur
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {taskModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {taskModal.mode === 'bulk' ? 'Toplu Görev Aç' : taskModal.mode === 'general' ? 'Görev Ekle' : 'Dosya Görevi Oluştur'}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {taskModal.mode === 'bulk'
                ? `${selectedCaseIds.length} seçili dosya için görev oluşturulacak.`
                : taskModal.mode === 'general'
                  ? 'Hızlı görev veya hukuk-özel akıllı görev oluşturabilirsiniz.'
                  : taskModal.caseTitle}
            </p>

            <div className="mt-3 max-h-[75vh] space-y-3 overflow-y-auto pr-1">
              {taskModal.mode !== 'bulk' ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={
                          taskEntryMode === 'quick'
                            ? 'rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white'
                            : 'rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700'
                        }
                        onClick={() => setTaskEntryMode('quick')}
                      >
                        Hızlı Görev Ekle
                      </button>
                      <button
                        type="button"
                        className={
                          taskEntryMode === 'smart'
                            ? 'rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white'
                            : 'rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700'
                        }
                        onClick={() => setTaskEntryMode('smart')}
                      >
                        Akıllı Görev Ekle
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {taskAiModel ? (
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                          AI: {taskAiModel.provider}/{taskAiModel.id}
                        </span>
                      ) : null}
                      <Button type="button" size="sm" variant="outline" disabled={isGeneratingTaskAssist} onClick={requestTaskAiAssist}>
                        {isGeneratingTaskAssist ? 'AI Öneriyor...' : 'AI ile Alt Görev Öner'}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {taskModal.mode === 'general' ? (
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Bağlı Dosya / Dava</label>
                  <select
                    value={taskCaseId}
                    onChange={(event) => {
                      const nextCaseId = event.target.value;
                      setTaskCaseId(nextCaseId);
                      const selectedCase = taskCaseOptions.find((item) => item.id === nextCaseId);
                      if (selectedCase && (taskTitle === 'Takip Görevi' || taskTitle.trim().length === 0)) {
                        setTaskTitle(`${selectedCase.title} - Takip Görevi`);
                      }
                      loadTaskCaseDocuments(nextCaseId).catch(() => {
                        setActionMessage('Görev belgeleri yüklenemedi.');
                      });
                    }}
                    className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                  >
                    <option value="">Dosya seçin</option>
                    {taskCaseOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                  {taskCaseOptions.length === 0 ? (
                    <p className="mt-1 text-xs text-orange-600">Dosya listesi boş görünüyor. Önce filtreleri gevşetip tekrar deneyin.</p>
                  ) : null}
                </div>
              ) : null}

              {taskModal.mode === 'single' ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
                  Bağlı dosya: <span className="font-semibold">{taskModal.caseTitle}</span>
                </div>
              ) : null}

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Hızlı Şablon</label>
                <div className="flex flex-wrap gap-2">
                  {TASK_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      onClick={() => {
                        const baseTitle = template.title;
                        const titlePrefix = taskModal.mode === 'single' && taskModal.caseTitle ? `${taskModal.caseTitle} - ` : '';
                        setTaskTitle(`${titlePrefix}${baseTitle}`);
                        setTaskPriority(template.priority);
                      }}
                    >
                      {template.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Görev Başlığı</label>
                <Input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Örn: Dava dilekçesi hazırla" />
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Öncelik</label>
                  <select
                    value={taskPriority}
                    onChange={(event) => setTaskPriority(event.target.value as 'low' | 'normal' | 'high')}
                    className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                  >
                    <option value="low">Düşük</option>
                    <option value="normal">Normal</option>
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
                    {teamMembers.length === 0 ? <option value="">Atama yapılmadı</option> : null}
                    {teamMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {(member.fullName ?? 'İsimsiz kullanıcı') + (member.isCurrentUser ? ' (Ben)' : '')}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Yasal Tarih Türü</label>
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

              {taskEntryMode === 'smart' && taskModal.mode !== 'bulk' ? (
                <>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Görev Tipi</label>
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
                        <option value="low">Düşük</option>
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
                      <Input value={taskCourt} onChange={(event) => setTaskCourt(event.target.value)} placeholder="Örn: İstanbul 4. Asliye Hukuk" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Dosya No</label>
                      <Input value={taskCourtFileNo} onChange={(event) => setTaskCourtFileNo(event.target.value)} placeholder="Örn: 2025/217 E." />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Karşı Taraf</label>
                      <Input value={taskOpponent} onChange={(event) => setTaskOpponent(event.target.value)} placeholder="Örn: ABC A.Ş." />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Açıklama</label>
                      <textarea
                        value={taskDescription}
                        onChange={(event) => setTaskDescription(event.target.value)}
                        className="min-h-24 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                        placeholder="Görevin kapsamını yazın"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">İlgili Not / Konuşma / Delil Referansları</label>
                      <textarea
                        value={taskReferenceInput}
                        onChange={(event) => setTaskReferenceInput(event.target.value)}
                        className="min-h-24 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                        placeholder="Her satıra bir referans: örn Not#12, Konuşma#34"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Ek Açıklama / Belge Notu</label>
                    <textarea
                      value={taskAttachmentNotes}
                      onChange={(event) => setTaskAttachmentNotes(event.target.value)}
                      className="min-h-20 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                      placeholder="Ek belge veya talimat notu"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">İliştirilecek Dosya Belgeleri</label>
                    {isTaskDocumentsLoading ? (
                      <p className="text-xs text-slate-500">Belgeler yükleniyor...</p>
                    ) : taskDocuments.length === 0 ? (
                      <p className="text-xs text-slate-500">Bu dosyada iliştirilecek belge bulunamadı.</p>
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
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">AI Önerileri</p>
                      {taskAiSubtasks.length > 0 ? (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-blue-700">Alt Görevler</p>
                          <ul className="mt-1 space-y-1 text-xs text-blue-900">
                            {taskAiSubtasks.map((item, index) => (
                              <li key={`${item}-${index}`}>- {item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {taskAiMissingFields.length > 0 ? (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-orange-700">Eksik Bilgi Uyarısı</p>
                          <ul className="mt-1 space-y-1 text-xs text-orange-900">
                            {taskAiMissingFields.map((item, index) => (
                              <li key={`${item}-${index}`}>- {item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {taskAiReminder ? <p className="mt-2 text-xs text-slate-700">Hatırlatma: {taskAiReminder}</p> : null}
                      {taskAiTemplate ? <p className="mt-1 text-xs text-slate-700">Şablon Önerisi: {taskAiTemplate}</p> : null}
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
                  setTaskModal(null);
                  resetTaskDraft({ assigneeId: getPreferredTaskAssigneeId(), mode: 'quick' });
                }}
              >
                Vazgeç
              </Button>
              <Button type="button" disabled={isApplyingAction || !canSubmitTask} onClick={submitTask}>
                Görev Oluştur
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
