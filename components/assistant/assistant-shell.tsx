'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AssistantBubble } from '@/components/assistant/assistant-bubble';
import { AssistantCommandWheel } from '@/components/assistant/assistant-command-wheel';
import { AssistantPanel } from '@/components/assistant/assistant-panel';
import { AssistantUndoBanner } from '@/components/assistant/assistant-undo-banner';
import { useAssistantShortcut } from '@/hooks/use-assistant-shortcut';
import { buildDefaultPreference } from '@/lib/assistant/defaults';
import { cn } from '@/lib/utils';
import { useAssistantStore } from '@/store/assistant-store';
import type {
  AssistantAuditLogItem,
  AssistantClientDirective,
  AssistantConversationSummary,
  AssistantLiveTimelineItem,
  AssistantMemoryItem,
  AssistantMessageItem,
  AssistantPendingAction,
  AssistantPreferencePayload,
  AssistantProactiveSignal,
  AssistantQuickActionItem,
  AssistantStyleProfile,
  AssistantUndoOption,
} from '@/types/assistant';

const POSITION_STORAGE_KEY = 'babylexit_assistant_bubble_position_v2';
const CORNER_STATS_STORAGE_KEY = 'babylexit_assistant_corner_stats_v1';
const STYLE_PROFILE_STORAGE_KEY = 'babylexit_assistant_style_profile_v1';
const UNDO_STORAGE_KEY = 'babylexit_assistant_undo_v1';
const LONG_PRESS_MS = 420;
const EDGE_GAP = 12;
const MOBILE_BOTTOM_SAFE = 88;
const DESKTOP_BOTTOM_SAFE = 20;
const DRAG_THRESHOLD = 3;

type ConversationsPayload = {
  conversations: AssistantConversationSummary[];
  quickActions: AssistantQuickActionItem[];
  auditLogs: AssistantAuditLogItem[];
};

type BubbleCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

type CommandStyleProfile = AssistantStyleProfile;

type CommandWheelAction = {
  key: string;
  label: string;
  quickActionKey: string;
  prompt: string;
};

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

const DEFAULT_STYLE_PROFILE: CommandStyleProfile = {
  preferredTone: 'professional',
  preferredLength: 'short',
  commandCounters: {},
};

const EMPTY_CORNER_STATS: Record<BubbleCorner, number> = {
  'top-left': 0,
  'top-right': 0,
  'bottom-left': 0,
  'bottom-right': 0,
};

function getBounds(bubbleSize: number) {
  const bottomSafe = window.innerWidth < 768 ? MOBILE_BOTTOM_SAFE : DESKTOP_BOTTOM_SAFE;
  const minX = EDGE_GAP;
  const maxX = Math.max(minX, window.innerWidth - bubbleSize - EDGE_GAP);
  const minY = EDGE_GAP;
  const maxY = Math.max(minY, window.innerHeight - bubbleSize - bottomSafe);
  return { minX, maxX, minY, maxY };
}

function clampPosition(x: number, y: number, bubbleSize: number) {
  const bounds = getBounds(bubbleSize);
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, y)),
  };
}

function defaultPosition(bubbleSize: number) {
  const bounds = getBounds(bubbleSize);
  return {
    x: bounds.maxX,
    y: bounds.maxY,
  };
}

function getTopCommands(counters: Record<string, number>) {
  return Object.entries(counters)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key]) => key);
}

function buildRouteContext(pathname: string, styleProfile: CommandStyleProfile) {
  const segments = pathname.split('/').filter(Boolean);
  const detailId = segments.length >= 3 ? segments[2] : undefined;
  const topCommands = getTopCommands(styleProfile.commandCounters);

  if (pathname.startsWith('/dashboard/cases/')) {
    return {
      pathname,
      section: 'cases',
      focus: 'case_detail',
      entityType: 'case',
      entityId: detailId,
      focusType: 'case' as const,
      focusId: detailId,
      queryHints: ['dava', 'evrak', 'duruşma', 'müvekkil', 'risk'],
      preferredTone: styleProfile.preferredTone,
      preferredLength: styleProfile.preferredLength,
      topCommands,
    };
  }

  if (pathname.startsWith('/dashboard/cases')) {
    return {
      pathname,
      section: 'cases',
      focus: 'case_list',
      focusType: 'case' as const,
      queryHints: ['dava', 'liste', 'takvim', 'risk'],
      preferredTone: styleProfile.preferredTone,
      preferredLength: styleProfile.preferredLength,
      topCommands,
    };
  }

  if (pathname.startsWith('/dashboard/tasks')) {
    return {
      pathname,
      section: 'tasks',
      focus: 'task_list',
      focusType: 'task' as const,
      queryHints: ['görev', 'deadline', 'öncelik', 'geciken'],
      preferredTone: styleProfile.preferredTone,
      preferredLength: styleProfile.preferredLength,
      topCommands,
    };
  }

  if (pathname.startsWith('/dashboard/clients/')) {
    return {
      pathname,
      section: 'clients',
      focus: 'client_detail',
      entityType: 'client',
      entityId: detailId,
      focusType: 'client' as const,
      focusId: detailId,
      queryHints: ['müvekkil', 'iletişim', 'dosyalar', 'notlar'],
      preferredTone: styleProfile.preferredTone,
      preferredLength: styleProfile.preferredLength,
      topCommands,
    };
  }

  if (pathname.startsWith('/dashboard/clients')) {
    return {
      pathname,
      section: 'clients',
      focus: 'client_workflow',
      focusType: 'client' as const,
      queryHints: ['müvekkil', 'takip', 'iletişim'],
      preferredTone: styleProfile.preferredTone,
      preferredLength: styleProfile.preferredLength,
      topCommands,
    };
  }

  if (pathname.startsWith('/dashboard/mail')) {
    return {
      pathname,
      section: 'mail',
      focus: 'mail_workspace',
      focusType: 'general' as const,
      queryHints: ['mail', 'gelen kutusu', 'öncelik', 'takip'],
      preferredTone: styleProfile.preferredTone,
      preferredLength: styleProfile.preferredLength,
      topCommands,
    };
  }

  if (pathname.startsWith('/dashboard/calendar')) {
    return {
      pathname,
      section: 'calendar',
      focus: 'calendar_workspace',
      focusType: 'general' as const,
      queryHints: ['takvim', 'toplantı', 'duruşma'],
      preferredTone: styleProfile.preferredTone,
      preferredLength: styleProfile.preferredLength,
      topCommands,
    };
  }

  if (pathname.startsWith('/tools/hukuk-ai')) {
    return {
      pathname,
      section: 'hukuk_ai',
      focus: 'chat_workspace',
      focusType: 'general' as const,
      queryHints: ['hukuk-ai', 'araştırma', 'soru'],
      preferredTone: styleProfile.preferredTone,
      preferredLength: styleProfile.preferredLength,
      topCommands,
    };
  }

  if (pathname.startsWith('/editor')) {
    return {
      pathname,
      section: 'documents',
      focus: 'document_workspace',
      focusType: 'general' as const,
      queryHints: ['belge', 'dosya', 'özet', 'çıkarım'],
      preferredTone: styleProfile.preferredTone,
      preferredLength: styleProfile.preferredLength,
      topCommands,
    };
  }

  if (pathname.startsWith('/dashboard/time-billing')) {
    return {
      pathname,
      section: 'time_billing',
      focus: 'billing_overview',
      focusType: 'general' as const,
      queryHints: ['zaman', 'faturalandırma', 'tahsilat'],
      preferredTone: styleProfile.preferredTone,
      preferredLength: styleProfile.preferredLength,
      topCommands,
    };
  }

  return {
    pathname,
    section: 'general',
    focus: 'workspace',
    focusType: 'general' as const,
    queryHints: ['ofis', 'yardım', 'özet'],
    preferredTone: styleProfile.preferredTone,
    preferredLength: styleProfile.preferredLength,
    topCommands,
  };
}

function mapBubbleStatus(state: ReturnType<typeof useAssistantStore.getState>['bubbleState']) {
  if (state === 'thinking') return 'Düşünüyor';
  if (state === 'working') return 'İşlem yürütüyor';
  if (state === 'needs_confirmation') return 'Onay bekliyor';
  if (state === 'success') return 'Tamamlandı';
  if (state === 'error') return 'Hata';
  if (state === 'listening') return 'Dinliyor';
  return 'Çevrim içi';
}

function createLocalMessage(role: 'user' | 'assistant', content: string): AssistantMessageItem {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    metadata: null,
  };
}

function createTimelineItem(
  step: string,
  status: AssistantLiveTimelineItem['status'],
  detail?: string,
): AssistantLiveTimelineItem {
  return {
    id: crypto.randomUUID(),
    step,
    status,
    detail,
    createdAt: new Date().toISOString(),
  };
}

function parseClientDirectives(payload: Record<string, unknown>) {
  const raw = payload.clientDirectives;
  if (!Array.isArray(raw)) {
    return [] as AssistantClientDirective[];
  }

  return raw.filter((item): item is AssistantClientDirective => {
    if (typeof item !== 'object' || item === null) {
      return false;
    }
    const candidate = item as Record<string, unknown>;
    return candidate.type === 'NAVIGATE' && typeof candidate.route === 'string' && candidate.route.startsWith('/');
  });
}

function parseUndoOptions(payload: Record<string, unknown>) {
  const raw = payload.undoOptions;
  if (!Array.isArray(raw)) {
    return [] as AssistantUndoOption[];
  }

  return raw
    .filter((item): item is AssistantUndoOption => {
      if (typeof item !== 'object' || item === null) {
        return false;
      }
      const candidate = item as Record<string, unknown>;
      return (
        typeof candidate.toolName === 'string' &&
        typeof candidate.label === 'string' &&
        typeof candidate.expiresInSec === 'number' &&
        typeof candidate.params === 'object' &&
        candidate.params !== null
      );
    })
    .map((item) => ({
      ...item,
      expiresInSec: Math.min(30, Math.max(10, Math.floor(item.expiresInSec))),
    }));
}

function parseUndoOption(payload: Record<string, unknown>) {
  const raw = payload.undoOption;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.toolName !== 'string' ||
    typeof candidate.label !== 'string' ||
    typeof candidate.expiresInSec !== 'number' ||
    typeof candidate.params !== 'object' ||
    candidate.params === null
  ) {
    return null;
  }

  return {
    toolName: candidate.toolName,
    label: candidate.label,
    expiresInSec: Math.min(30, Math.max(10, Math.floor(candidate.expiresInSec))),
    params: candidate.params as Record<string, unknown>,
  } satisfies AssistantUndoOption;
}

function parseStoredUndo(raw: string | null) {
  if (!raw) {
    return null;
  }

  const parsed = safeJsonParse<{ option?: AssistantUndoOption; deadline?: number }>(raw, {});
  if (!parsed.option || typeof parsed.deadline !== 'number') {
    return null;
  }
  if (parsed.deadline <= Date.now()) {
    return null;
  }

  return {
    option: parsed.option,
    deadline: parsed.deadline,
  };
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadStyleProfileFromStorage(): CommandStyleProfile {
  if (typeof window === 'undefined') {
    return DEFAULT_STYLE_PROFILE;
  }

  const raw = localStorage.getItem(STYLE_PROFILE_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_STYLE_PROFILE;
  }

  const parsed = safeJsonParse<Partial<CommandStyleProfile>>(raw, {});
  return {
    preferredTone:
      parsed.preferredTone === 'professional' ||
      parsed.preferredTone === 'warm' ||
      parsed.preferredTone === 'short' ||
      parsed.preferredTone === 'detailed'
        ? parsed.preferredTone
        : DEFAULT_STYLE_PROFILE.preferredTone,
    preferredLength: parsed.preferredLength === 'detailed' ? 'detailed' : 'short',
    commandCounters: parsed.commandCounters && typeof parsed.commandCounters === 'object' ? parsed.commandCounters : {},
  };
}

function detectMessageTone(message: string) {
  const lowered = message.toLocaleLowerCase('tr-TR');
  if (lowered.includes('kısa') || lowered.includes('kisa') || lowered.includes('özet')) {
    return 'short' as const;
  }
  if (lowered.includes('detay') || lowered.includes('ayrıntı') || lowered.includes('ayrinti')) {
    return 'detailed' as const;
  }
  if (lowered.includes('knk') || lowered.includes('kanka') || lowered.includes('abi')) {
    return 'warm' as const;
  }
  if (lowered.includes('lütfen') || lowered.includes('lutfen') || lowered.includes('rica')) {
    return 'professional' as const;
  }
  return null;
}

function detectMessageLength(message: string) {
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.length > 160 ? 'detailed' : 'short';
}

function normalizeCommandKey(message: string) {
  const normalized = message
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return 'generic';
  }

  return normalized.split(' ').slice(0, 4).join('_');
}

function loadCornerStatsFromStorage() {
  if (typeof window === 'undefined') {
    return EMPTY_CORNER_STATS;
  }

  const raw = localStorage.getItem(CORNER_STATS_STORAGE_KEY);
  if (!raw) {
    return EMPTY_CORNER_STATS;
  }
  const parsed = safeJsonParse<Partial<Record<BubbleCorner, number>>>(raw, {});
  return {
    'top-left': Number.isFinite(parsed['top-left']) ? Number(parsed['top-left']) : 0,
    'top-right': Number.isFinite(parsed['top-right']) ? Number(parsed['top-right']) : 0,
    'bottom-left': Number.isFinite(parsed['bottom-left']) ? Number(parsed['bottom-left']) : 0,
    'bottom-right': Number.isFinite(parsed['bottom-right']) ? Number(parsed['bottom-right']) : 0,
  };
}

function saveCornerStats(stats: Record<BubbleCorner, number>) {
  localStorage.setItem(CORNER_STATS_STORAGE_KEY, JSON.stringify(stats));
}

function getPreferredCorner(stats: Record<BubbleCorner, number>) {
  const entries = Object.entries(stats) as Array<[BubbleCorner, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  if (!entries[0] || entries[0][1] <= 0) {
    return null;
  }
  return entries[0][0];
}

function getCornerPoint(corner: BubbleCorner, bounds: ReturnType<typeof getBounds>) {
  if (corner === 'top-left') return { x: bounds.minX, y: bounds.minY };
  if (corner === 'top-right') return { x: bounds.maxX, y: bounds.minY };
  if (corner === 'bottom-left') return { x: bounds.minX, y: bounds.maxY };
  return { x: bounds.maxX, y: bounds.maxY };
}

function detectCornerForPosition(position: { x: number; y: number }, bounds: ReturnType<typeof getBounds>) {
  const horizontalMid = (bounds.minX + bounds.maxX) / 2;
  const verticalMid = (bounds.minY + bounds.maxY) / 2;
  if (position.x <= horizontalMid && position.y <= verticalMid) return 'top-left' as const;
  if (position.x > horizontalMid && position.y <= verticalMid) return 'top-right' as const;
  if (position.x <= horizontalMid && position.y > verticalMid) return 'bottom-left' as const;
  return 'bottom-right' as const;
}

function chooseSmartSnapPosition(
  current: { x: number; y: number },
  bubbleSize: number,
  preferredCorner: BubbleCorner | null,
) {
  const bounds = getBounds(bubbleSize);
  const corners: BubbleCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

  let bestCorner = corners[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const corner of corners) {
    const point = getCornerPoint(corner, bounds);
    const distance = Math.hypot(current.x - point.x, current.y - point.y);
    const preferredBias = preferredCorner === corner ? -48 : 0;
    const score = distance + preferredBias;
    if (score < bestScore) {
      bestScore = score;
      bestCorner = corner;
    }
  }

  const snappedPoint = getCornerPoint(bestCorner, bounds);
  return {
    corner: bestCorner,
    position: clampPosition(snappedPoint.x, snappedPoint.y, bubbleSize),
  };
}

async function readEventStream(response: Response, onEvent: (event: string, payload: Record<string, unknown>) => void) {
  const reader = response.body?.getReader();
  if (!reader) {
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      const lines = block.split('\n');
      const eventLine = lines.find((line) => line.startsWith('event:'));
      const data = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace('data:', '').trim())
        .join('');

      const event = eventLine?.replace('event:', '').trim() || 'message';
      const payload = safeJsonParse<Record<string, unknown>>(data || '{}', {});
      onEvent(event, payload);
    }
  }
}

export function AssistantShell() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    isOpen,
    bubbleState,
    unreadCount,
    activeConversationId,
    tab,
    bubbleX,
    bubbleY,
    bubbleSize,
    hasHydratedPosition,
    setOpen,
    toggleOpen,
    setBubbleState,
    incrementUnread,
    resetUnread,
    setActiveConversationId,
    setTab,
    setBubblePosition,
    setBubbleSize,
    setHasHydratedPosition,
  } = useAssistantStore();

  const [localMessages, setLocalMessages] = useState<AssistantMessageItem[]>([]);
  const [pendingActions, setPendingActions] = useState<AssistantPendingAction[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isConfirmingAction, setIsConfirmingAction] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [liveTimeline, setLiveTimeline] = useState<AssistantLiveTimelineItem[]>([]);
  const [styleProfile, setStyleProfile] = useState<CommandStyleProfile>(DEFAULT_STYLE_PROFILE);
  const [cornerStats, setCornerStats] = useState<Record<BubbleCorner, number>>(EMPTY_CORNER_STATS);
  const [commandWheelOpen, setCommandWheelOpen] = useState(false);
  const [undoOption, setUndoOption] = useState<AssistantUndoOption | null>(null);
  const [undoDeadline, setUndoDeadline] = useState<number | null>(null);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0);
  const [isUndoing, setIsUndoing] = useState(false);
  const [proactiveSignal, setProactiveSignal] = useState<AssistantProactiveSignal | null>(null);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [engagementTick, setEngagementTick] = useState(() => Date.now());

  const draggingRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    moved: false,
  });
  const latestBubblePositionRef = useRef({ x: bubbleX, y: bubbleY });
  const requestInFlightRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const lastActiveAtRef = useRef(Date.now());
  const lastSignalIdRef = useRef<string>('');
  const cornerStatsRef = useRef<Record<BubbleCorner, number>>(EMPTY_CORNER_STATS);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const styleProfileReadyRef = useRef(false);
  const lastSyncedStyleProfileRef = useRef('');

  const appendTimeline = useCallback((step: string, status: AssistantLiveTimelineItem['status'], detail?: string) => {
    setLiveTimeline((current) => [...current.slice(-23), createTimelineItem(step, status, detail)]);
  }, []);

  const armUndo = useCallback((nextUndo: AssistantUndoOption) => {
    setUndoOption(nextUndo);
    setUndoDeadline(Date.now() + nextUndo.expiresInSec * 1000);
    appendTimeline('Geri al penceresi açıldı', 'done', nextUndo.label);
  }, [appendTimeline]);

  const updateStyleProfile = useCallback((message: string, quickActionKey?: string) => {
    setStyleProfile((current) => {
      const detectedTone = detectMessageTone(message);
      const commandKey = quickActionKey || normalizeCommandKey(message);
      const nextCounters = {
        ...current.commandCounters,
        [commandKey]: (current.commandCounters[commandKey] ?? 0) + 1,
      };
      const nextProfile: CommandStyleProfile = {
        preferredTone: detectedTone ?? current.preferredTone,
        preferredLength: detectMessageLength(message),
        commandCounters: nextCounters,
      };
      localStorage.setItem(STYLE_PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
      return nextProfile;
    });
  }, []);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const preferencesQuery = useQuery({
    queryKey: ['assistant', 'preferences'],
    queryFn: async () => {
      const response = await fetch('/api/assistant/preferences', { cache: 'no-store' });
      if (response.status === 401) {
        return null;
      }
      if (!response.ok) {
        throw new Error('Ayarlar alınamadı.');
      }
      const data = (await response.json()) as { preference: AssistantPreferencePayload };
      return data.preference;
    },
    retry: false,
  });

  const conversationsQuery = useQuery({
    queryKey: ['assistant', 'conversations'],
    queryFn: async () => {
      const response = await fetch('/api/assistant/conversations', { cache: 'no-store' });
      if (response.status === 401) {
        return {
          conversations: [],
          quickActions: [],
          auditLogs: [],
        } satisfies ConversationsPayload;
      }
      if (!response.ok) {
        throw new Error('Konuşmalar alınamadı.');
      }
      return (await response.json()) as ConversationsPayload;
    },
    retry: false,
  });

  const messagesQuery = useQuery({
    queryKey: ['assistant', 'messages', activeConversationId],
    enabled: Boolean(activeConversationId),
    queryFn: async () => {
      const response = await fetch(`/api/assistant/conversations/${activeConversationId}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Mesajlar alınamadı.');
      }
      const data = (await response.json()) as { messages: AssistantMessageItem[] };
      return data.messages;
    },
  });

  const memoryQuery = useQuery({
    queryKey: ['assistant', 'memory'],
    queryFn: async () => {
      const response = await fetch('/api/assistant/memory', { cache: 'no-store' });
      if (response.status === 401) {
        return [];
      }
      if (!response.ok) {
        throw new Error('Hafıza alınamadı.');
      }
      const data = (await response.json()) as { items: AssistantMemoryItem[] };
      return data.items;
    },
    retry: false,
  });

  const styleProfileQuery = useQuery({
    queryKey: ['assistant', 'style-profile'],
    queryFn: async () => {
      const response = await fetch('/api/assistant/style-profile', { cache: 'no-store' });
      if (response.status === 401) {
        return null;
      }
      if (!response.ok) {
        throw new Error('Stil profili alınamadı.');
      }
      const data = (await response.json()) as { profile: AssistantStyleProfile };
      return data.profile;
    },
    retry: false,
  });

  const savePreferencesMutation = useMutation({
    mutationFn: async (payload: AssistantPreferencePayload) => {
      const response = await fetch('/api/assistant/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error('Ayarlar kaydedilemedi.');
      }
      return (await response.json()) as { preference: AssistantPreferencePayload };
    },
    onSuccess: ({ preference }) => {
      queryClient.setQueryData(['assistant', 'preferences'], preference);
      setBubbleSize(preference.bubbleSize);
      if (hasHydratedPosition) {
        const clamped = clampPosition(preference.bubblePositionX, preference.bubblePositionY, preference.bubbleSize);
        setBubblePosition(clamped.x, clamped.y);
        latestBubblePositionRef.current = clamped;
      }
    },
  });

  const memoryCreateMutation = useMutation({
    mutationFn: async (payload: { content: string; kind: 'NOTE' | 'PREFERENCE' | 'FACT'; tags: string[] }) => {
      const response = await fetch('/api/assistant/memory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error('Hafıza kaydı oluşturulamadı.');
      }
      return response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'memory'] });
    },
  });

  const memoryDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch('/api/assistant/memory', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        throw new Error('Hafıza kaydı silinemedi.');
      }
      return response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'memory'] });
    },
  });

  const newConversationMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/assistant/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Yeni sohbet',
          isTemporary: preferencesQuery.data?.temporaryMode ?? false,
        }),
      });
      if (!response.ok) {
        throw new Error('Yeni konuşma oluşturulamadı.');
      }
      return (await response.json()) as { conversation: AssistantConversationSummary };
    },
    onSuccess: ({ conversation }) => {
      setActiveConversationId(conversation.id);
      setLocalMessages([]);
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] });
    },
  });

  const preference = preferencesQuery.data ?? buildDefaultPreference();
  const assistantName = preference.assistantName;
  const userName = 'Sen';
  const baseQuickActions = conversationsQuery.data?.quickActions ?? [];
  const conversationList = conversationsQuery.data?.conversations ?? [];
  const auditLogs = conversationsQuery.data?.auditLogs ?? [];
  const memoryItems = memoryQuery.data ?? [];
  const pendingAction = pendingActions.length > 0 ? pendingActions[0] : null;
  const statusLabel = lastError ? `Hata: ${lastError}` : mapBubbleStatus(bubbleState);

  const routeContext = useMemo(() => buildRouteContext(pathname, styleProfile), [pathname, styleProfile]);

  const contextualQuickActions = useMemo<AssistantQuickActionItem[]>(() => {
    if (routeContext.section === 'cases' || routeContext.section === 'documents') {
      return [
        {
          key: 'context_doc_summary',
          label: 'Dosyayı özetle',
          description: 'Aktif dosya bağlamında kısa özet çıkarır.',
          prompt: 'Bu dosyayı kısaca özetle ve kritik riskleri belirt.',
          icon: 'FileText',
          requiresConfirmation: false,
        },
        {
          key: 'context_doc_tasks',
          label: 'Dosyadan görev çıkar',
          description: 'Dosya bağlamından uygulanabilir görev listesi üretir.',
          prompt: 'Bu dosyadan yapılacakları çıkar ve önceliklendir.',
          icon: 'ListTodo',
          requiresConfirmation: true,
        },
      ];
    }

    if (routeContext.section === 'mail') {
      return [
        {
          key: 'context_mail_priority',
          label: 'Öncelikli mailleri çıkar',
          description: 'Acil mailleri hızlıca listeler.',
          prompt: 'Son mailler içinden öncelikli olanları listele.',
          icon: 'Mail',
          requiresConfirmation: false,
        },
      ];
    }

    if (routeContext.section === 'clients') {
      return [
        {
          key: 'context_client_message',
          label: 'Müvekkile mesaj gönder',
          description: 'Müvekkile hızlı mesaj taslağı hazırlar.',
          prompt: 'Müvekkil Kerim’e mesaj at "Merhaba, dosyanız için bugün 14:00’te bilgilendirme yapacağım."',
          icon: 'MessageCircle',
          requiresConfirmation: true,
        },
      ];
    }

    return [];
  }, [routeContext.section]);

  const quickActions = useMemo(() => {
    const seen = new Set<string>();
    const merged: AssistantQuickActionItem[] = [];

    for (const item of [...contextualQuickActions, ...baseQuickActions]) {
      if (seen.has(item.key)) {
        continue;
      }
      seen.add(item.key);
      merged.push(item);
    }

    return merged.slice(0, 10);
  }, [baseQuickActions, contextualQuickActions]);

  const idleMs = engagementTick - lastActiveAtRef.current;
  const adaptiveBubbleSize = useMemo(() => {
    let next = bubbleSize;

    if (!isOpen && idleMs < 20_000) {
      next = Math.max(64, next - 6);
    } else if (!isOpen && idleMs > 60_000) {
      next = Math.min(124, next + 4);
    }

    if (bubbleState === 'working' || bubbleState === 'needs_confirmation') {
      next = Math.min(124, next + 2);
    }

    return next;
  }, [bubbleSize, bubbleState, idleMs, isOpen]);

  useEffect(() => {
    const localStyle = loadStyleProfileFromStorage();
    setStyleProfile(localStyle);
    styleProfileReadyRef.current = true;
    lastSyncedStyleProfileRef.current = JSON.stringify(localStyle);

    const loadedCornerStats = loadCornerStatsFromStorage();
    setCornerStats(loadedCornerStats);
    cornerStatsRef.current = loadedCornerStats;

    const storedUndo = parseStoredUndo(localStorage.getItem(UNDO_STORAGE_KEY));
    if (storedUndo) {
      setUndoOption(storedUndo.option);
      setUndoDeadline(storedUndo.deadline);
    }
  }, []);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setEngagementTick(Date.now());
    }, 12_000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!styleProfileQuery.data) {
      return;
    }

    setStyleProfile(styleProfileQuery.data);
    const serialized = JSON.stringify(styleProfileQuery.data);
    localStorage.setItem(STYLE_PROFILE_STORAGE_KEY, serialized);
    lastSyncedStyleProfileRef.current = serialized;
    styleProfileReadyRef.current = true;
  }, [styleProfileQuery.data]);

  useEffect(() => {
    const markActive = () => {
      lastActiveAtRef.current = Date.now();
      setEngagementTick(Date.now());
    };

    window.addEventListener('pointerdown', markActive, { passive: true });
    window.addEventListener('keydown', markActive);
    window.addEventListener('scroll', markActive, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', markActive);
      window.removeEventListener('keydown', markActive);
      window.removeEventListener('scroll', markActive);
    };
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!styleProfileReadyRef.current || preferencesQuery.data === null) {
      return;
    }

    const serialized = JSON.stringify(styleProfile);
    if (serialized === lastSyncedStyleProfileRef.current) {
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/assistant/style-profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: serialized,
        });
        if (response.ok) {
          lastSyncedStyleProfileRef.current = serialized;
        }
      } catch {
        // sync hatası sessiz geçilir
      }
    }, 550);

    return () => window.clearTimeout(timer);
  }, [preferencesQuery.data, styleProfile]);

  useEffect(() => {
    if (!hasHydratedPosition) {
      try {
        const raw = localStorage.getItem(POSITION_STORAGE_KEY);
        if (raw) {
          const parsed = safeJsonParse<{ x?: number; y?: number }>(raw, {});
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            const clamped = clampPosition(parsed.x, parsed.y, bubbleSize);
            setBubblePosition(clamped.x, clamped.y);
            setHasHydratedPosition(true);
            return;
          }
        }
      } catch {
        // ignore malformed storage
      }

      if (preferencesQuery.data) {
        const preferred = clampPosition(
          preferencesQuery.data.bubblePositionX,
          preferencesQuery.data.bubblePositionY,
          preferencesQuery.data.bubbleSize,
        );
        setBubblePosition(preferred.x, preferred.y);
        latestBubblePositionRef.current = preferred;
        setHasHydratedPosition(true);
        return;
      }

      const fallback = defaultPosition(bubbleSize);
      setBubblePosition(fallback.x, fallback.y);
      latestBubblePositionRef.current = fallback;
      setHasHydratedPosition(true);
    }
  }, [bubbleSize, hasHydratedPosition, preferencesQuery.data, setBubblePosition, setHasHydratedPosition]);

  useEffect(() => {
    if (!preferencesQuery.data) {
      return;
    }

    setBubbleSize(preferencesQuery.data.bubbleSize);

    if (!hasHydratedPosition) {
      return;
    }

    const clamped = clampPosition(bubbleX, bubbleY, preferencesQuery.data.bubbleSize);
    setBubblePosition(clamped.x, clamped.y);
  }, [bubbleX, bubbleY, hasHydratedPosition, preferencesQuery.data, setBubblePosition, setBubbleSize]);

  useEffect(() => {
    const list = conversationList;
    if (list.length === 0) {
      return;
    }
    if (!activeConversationId) {
      setActiveConversationId(list[0].id);
      return;
    }
    const exists = list.some((item) => item.id === activeConversationId);
    if (!exists) {
      setActiveConversationId(list[0].id);
    }
  }, [activeConversationId, conversationList, setActiveConversationId]);

  useEffect(() => {
    setLocalMessages(messagesQuery.data ?? []);
    setLiveTimeline([]);
  }, [messagesQuery.data, activeConversationId]);

  useEffect(() => {
    latestBubblePositionRef.current = { x: bubbleX, y: bubbleY };
  }, [bubbleX, bubbleY]);

  useEffect(() => {
    if (isOpen) {
      resetUnread();
      if (!pendingAction) {
        setBubbleState(isTyping ? 'thinking' : 'idle');
      }
    } else if (!isTyping && !pendingAction) {
      setBubbleState('idle');
    }
  }, [isOpen, isTyping, pendingAction, resetUnread, setBubbleState]);

  useEffect(() => {
    if (pendingAction) {
      setBubbleState('needs_confirmation');
      appendTimeline('Kritik işlem onayı bekleniyor', 'running', pendingAction.summary);
    }
  }, [appendTimeline, pendingAction, setBubbleState]);

  useEffect(() => {
    const handleResize = () => {
      const clamped = clampPosition(bubbleX, bubbleY, adaptiveBubbleSize);
      setBubblePosition(clamped.x, clamped.y);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [adaptiveBubbleSize, bubbleX, bubbleY, setBubblePosition]);

  useEffect(() => {
    if (!undoDeadline) {
      setUndoSecondsLeft(0);
      return;
    }

    const tick = () => {
      const seconds = Math.max(0, Math.ceil((undoDeadline - Date.now()) / 1000));
      setUndoSecondsLeft(seconds);
      if (seconds <= 0) {
        setUndoDeadline(null);
        setUndoOption(null);
      }
    };

    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [undoDeadline]);

  useEffect(() => {
    if (!undoOption || !undoDeadline) {
      localStorage.removeItem(UNDO_STORAGE_KEY);
      return;
    }

    localStorage.setItem(
      UNDO_STORAGE_KEY,
      JSON.stringify({
        option: undoOption,
        deadline: undoDeadline,
      }),
    );
  }, [undoDeadline, undoOption]);

  useEffect(() => {
    if (!preferencesQuery.data) {
      return;
    }

    let aborted = false;

    const poll = async () => {
      try {
        const params = new URLSearchParams({
          lastActiveAt: String(lastActiveAtRef.current),
        });
        if (lastSignalIdRef.current) {
          params.set('lastSignalId', lastSignalIdRef.current);
        }

        const response = await fetch(`/api/assistant/proactive?${params.toString()}`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { signal?: AssistantProactiveSignal | null };
        if (aborted || !payload.signal) {
          return;
        }

        if (payload.signal.id === lastSignalIdRef.current) {
          return;
        }

        lastSignalIdRef.current = payload.signal.id;
        setProactiveSignal(payload.signal);
        appendTimeline('Proaktif uyarı oluşturuldu', 'done', payload.signal.message);

        const text = payload.signal.suggestion
          ? `${payload.signal.message} ${payload.signal.suggestion}`
          : payload.signal.message;

        setLocalMessages((current) => [...current, createLocalMessage('assistant', text)]);

        if (!isOpen) {
          incrementUnread();
        }

        if (payload.signal.level === 'critical') {
          setBubbleState('needs_confirmation');
        }
      } catch {
        // proactive polling hatalarını sessiz geç
      }
    };

    const bootstrapTimer = window.setTimeout(() => {
      void poll();
    }, 35_000);
    const interval = window.setInterval(() => {
      void poll();
    }, 120_000);

    return () => {
      aborted = true;
      window.clearTimeout(bootstrapTimer);
      window.clearInterval(interval);
    };
  }, [appendTimeline, incrementUnread, isOpen, preferencesQuery.data, setBubbleState]);

  useAssistantShortcut(preference.keyboardShortcut, () => {
    toggleOpen();
  });

  const applyClientDirectives = useCallback((directives: AssistantClientDirective[]) => {
    const navigation = [...directives].reverse().find((item) => item.type === 'NAVIGATE' && item.route.startsWith('/'));
    if (!navigation) {
      return;
    }
    const currentPathWithQuery =
      typeof window !== 'undefined' ? `${pathname}${window.location.search || ''}` : pathname;
    if (navigation.route === currentPathWithQuery) {
      return;
    }
    const nextRoute = navigation.route as Parameters<typeof router.push>[0];
    router.push(nextRoute);
  }, [pathname, router]);

  const handleUndo = useCallback(async () => {
    if (!undoOption || isUndoing) {
      return;
    }

    setIsUndoing(true);
    appendTimeline('Geri al işlemi başlatıldı', 'running', undoOption.label);

    try {
      const response = await fetch('/api/assistant/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationId: activeConversationId,
          toolName: undoOption.toolName,
          params: undoOption.params,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        summary?: string;
        error?: string;
        clientDirectives?: AssistantClientDirective[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Geri al işlemi çalıştırılamadı.');
      }

      const summary = payload.summary ?? 'İşlem geri alındı.';
      setLocalMessages((current) => [...current, createLocalMessage('assistant', summary)]);
      if (Array.isArray(payload.clientDirectives) && payload.clientDirectives.length > 0) {
        applyClientDirectives(payload.clientDirectives);
      }

      appendTimeline('Geri al tamamlandı', 'done', summary);
      setBubbleState('success');
      window.setTimeout(() => setBubbleState('idle'), 900);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Geri al işlemi başarısız oldu.';
      setLastError(message);
      appendTimeline('Geri al başarısız', 'error', message);
      setBubbleState('error');
      window.setTimeout(() => setBubbleState('idle'), 1000);
    } finally {
      setIsUndoing(false);
      setUndoOption(null);
      setUndoDeadline(null);
    }
  }, [activeConversationId, appendTimeline, applyClientDirectives, isUndoing, setBubbleState, undoOption]);

  const sendMessage = useCallback(async (message: string, quickActionKey?: string) => {
    if (requestInFlightRef.current) {
      return;
    }

    requestInFlightRef.current = true;
    setLastError(null);
    setIsTyping(true);
    setBubbleState('thinking');
    setCommandWheelOpen(false);
    setProactiveSignal(null);
    lastActiveAtRef.current = Date.now();
    setEngagementTick(Date.now());

    updateStyleProfile(message, quickActionKey);

    const userMessage = createLocalMessage('user', message);
    const assistantDraftId = crypto.randomUUID();
    setStreamingMessageId(assistantDraftId);
    setLocalMessages((current) => [
      ...current,
      userMessage,
      {
        id: assistantDraftId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        metadata: null,
      },
    ]);

    appendTimeline('Komut alındı', 'running', message.slice(0, 120));

    try {
      let tokenBuffer = '';
      let frameId: number | null = null;

      const flushTokenBuffer = () => {
        frameId = null;
        if (!tokenBuffer) {
          return;
        }
        const chunk = tokenBuffer;
        tokenBuffer = '';
        setLocalMessages((current) =>
          current.map((item) =>
            item.id === assistantDraftId
              ? {
                  ...item,
                  content: `${item.content}${chunk}`,
                }
              : item,
          ),
        );
      };

      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationId: useAssistantStore.getState().activeConversationId ?? undefined,
          message,
          quickActionKey,
          routeContext,
          stream: true,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'Sohbet hatası');
      }

      await readEventStream(response, (event, payload) => {
        if (event === 'token') {
          const token = typeof payload.token === 'string' ? payload.token : '';
          if (!token) return;
          tokenBuffer += token;
          if (frameId === null) {
            frameId = window.requestAnimationFrame(flushTokenBuffer);
          }
          return;
        }

        if (event === 'meta') {
          const pending = Array.isArray(payload.pendingActions) ? (payload.pendingActions as AssistantPendingAction[]) : [];
          if (pending.length > 0) {
            setPendingActions(pending);
            appendTimeline('Kritik işlem önizlemesi hazır', 'done', `${pending.length} işlem`);
          } else {
            appendTimeline('İşlem planı hazırlandı', 'done');
          }

          const directives = parseClientDirectives(payload);
          if (directives.length > 0) {
            applyClientDirectives(directives);
            appendTimeline('Sayfa yönlendirmesi uygulandı', 'done', directives[directives.length - 1]?.route);
          }

          const undos = parseUndoOptions(payload);
          if (undos.length > 0) {
            armUndo(undos[undos.length - 1]);
          }
          return;
        }

        if (event === 'done') {
          if (frameId !== null) {
            window.cancelAnimationFrame(frameId);
            frameId = null;
          }
          flushTokenBuffer();

          const pending = Array.isArray(payload.pendingActions) ? (payload.pendingActions as AssistantPendingAction[]) : [];
          setPendingActions((current) => [
            ...current,
            ...pending.filter((item) => !current.some((existing) => existing.executionId === item.executionId)),
          ]);

          const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : null;
          if (conversationId) {
            setActiveConversationId(conversationId);
          }

          const directives = parseClientDirectives(payload);
          if (directives.length > 0) {
            applyClientDirectives(directives);
          }

          const undos = parseUndoOptions(payload);
          if (undos.length > 0) {
            armUndo(undos[undos.length - 1]);
          }

          appendTimeline('Yanıt tamamlandı', 'done');
          setBubbleState(pending.length > 0 ? 'needs_confirmation' : 'success');
          window.setTimeout(() => {
            setBubbleState(pending.length > 0 ? 'needs_confirmation' : 'idle');
          }, 800);
          return;
        }

        if (event === 'error') {
          if (frameId !== null) {
            window.cancelAnimationFrame(frameId);
            frameId = null;
          }
          flushTokenBuffer();

          const messageText = typeof payload.message === 'string' ? payload.message : 'Yanıt üretilemedi.';
          setLastError(messageText);
          appendTimeline('Sohbet hatası', 'error', messageText);
          setBubbleState('error');
          setLocalMessages((current) =>
            current.map((item) => (item.id === assistantDraftId ? { ...item, content: messageText } : item)),
          );
          window.setTimeout(() => setBubbleState('idle'), 1200);
        }
      });

      if (!isOpen) {
        incrementUnread();
      }
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] });
      void queryClient.invalidateQueries({
        queryKey: ['assistant', 'messages', useAssistantStore.getState().activeConversationId],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sohbet sırasında hata oluştu.';
      setLastError(errorMessage);
      appendTimeline('Sohbet hatası', 'error', errorMessage);
      setBubbleState('error');
      setLocalMessages((current) =>
        current.map((item) =>
          item.id === assistantDraftId
            ? {
                ...item,
                content: `Üzgünüm, şu anda yanıt veremiyorum. ${errorMessage}`,
              }
            : item,
        ),
      );
      window.setTimeout(() => setBubbleState('idle'), 1200);
    } finally {
      setStreamingMessageId(null);
      setIsTyping(false);
      requestInFlightRef.current = false;
    }
  }, [
    appendTimeline,
    applyClientDirectives,
    armUndo,
    incrementUnread,
    isOpen,
    queryClient,
    routeContext,
    setActiveConversationId,
    setBubbleState,
    updateStyleProfile,
  ]);

  const handlePendingConfirm = useCallback(async () => {
    if (!pendingAction || isConfirmingAction) {
      return;
    }
    setIsConfirmingAction(true);
    setBubbleState('working');
    appendTimeline('Onaylı işlem başlatıldı', 'running', pendingAction.summary);

    try {
      const response = await fetch('/api/assistant/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationId: activeConversationId,
          toolName: pendingAction.toolName,
          params: pendingAction.params,
          confirmation: {
            approved: true,
            executionId: pendingAction.executionId,
          },
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        summary?: string;
        error?: string;
        undoOption?: AssistantUndoOption;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? 'İşlem çalıştırılamadı.');
      }
      const directives = parseClientDirectives(payload as Record<string, unknown>);
      if (directives.length > 0) {
        applyClientDirectives(directives);
      }

      const parsedUndo = parseUndoOption(payload as Record<string, unknown>);
      if (parsedUndo) {
        armUndo(parsedUndo);
      }

      const summary = payload.summary ?? 'İşlem tamamlandı.';
      setLocalMessages((current) => [...current, createLocalMessage('assistant', summary)]);
      setPendingActions((current) => current.slice(1));
      appendTimeline('Onaylı işlem tamamlandı', 'done', summary);
      setBubbleState('success');
      window.setTimeout(() => setBubbleState('idle'), 900);
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Onaylı işlemde hata oluştu.';
      setLastError(message);
      appendTimeline('Onaylı işlem hatası', 'error', message);
      setBubbleState('error');
      window.setTimeout(() => setBubbleState('idle'), 1200);
    } finally {
      setIsConfirmingAction(false);
    }
  }, [
    activeConversationId,
    appendTimeline,
    applyClientDirectives,
    armUndo,
    isConfirmingAction,
    pendingAction,
    queryClient,
    setBubbleState,
  ]);

  const handlePendingCancel = useCallback(async () => {
    if (!pendingAction) {
      return;
    }

    try {
      await fetch('/api/assistant/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationId: activeConversationId,
          toolName: pendingAction.toolName,
          params: pendingAction.params,
          confirmation: {
            approved: false,
            executionId: pendingAction.executionId,
          },
        }),
      });
    } catch {
      // cancel request is best-effort
    }

    appendTimeline('İşlem iptal edildi', 'done', pendingAction.summary);
    setPendingActions((current) => current.slice(1));
    setBubbleState('idle');
  }, [activeConversationId, appendTimeline, pendingAction, setBubbleState]);

  const handleVoiceClick = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const browserWindow = window as Window & {
      SpeechRecognition?: new () => BrowserSpeechRecognition;
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    };
    const RecognitionCtor = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;

    if (!RecognitionCtor) {
      setLastError('Tarayıcıda sesli giriş desteklenmiyor. Yazılı modda devam edebilirsin.');
      return;
    }

    if (recognitionRef.current && isVoiceListening) {
      recognitionRef.current.stop();
      return;
    }

    const recognition = new RecognitionCtor();
    recognition.lang = 'tr-TR';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const item = event.results[index];
        if (item && item.isFinal) {
          transcript += item[0]?.transcript ?? '';
        }
      }

      const clean = transcript.trim();
      if (clean.length > 0) {
        void sendMessage(clean);
      }
    };

    recognition.onerror = () => {
      setLastError('Sesli girişte hata oluştu. Yazılı modla devam edebilirsin.');
      setIsVoiceListening(false);
      setBubbleState('idle');
    };

    recognition.onend = () => {
      setIsVoiceListening(false);
      setBubbleState('idle');
    };

    recognitionRef.current = recognition;
    setIsVoiceListening(true);
    setBubbleState('listening');
    recognition.start();
  }, [isVoiceListening, sendMessage, setBubbleState]);

  const handleBubblePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (commandWheelOpen) {
      setCommandWheelOpen(false);
      return;
    }

    event.preventDefault();
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // pointer capture is optional
    }

    longPressTriggeredRef.current = false;
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      if (draggingRef.current.pointerId === event.pointerId && !draggingRef.current.moved) {
        longPressTriggeredRef.current = true;
        setCommandWheelOpen(true);
        setBubbleState('listening');
        appendTimeline('Mini komut çarkı açıldı', 'running');
      }
    }, LONG_PRESS_MS);

    draggingRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialX: bubbleX,
      initialY: bubbleY,
      moved: false,
    };

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: PointerEvent) => {
      if (draggingRef.current.pointerId !== moveEvent.pointerId) {
        return;
      }

      const dx = moveEvent.clientX - draggingRef.current.startX;
      const dy = moveEvent.clientY - draggingRef.current.startY;
      if (!draggingRef.current.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
        return;
      }

      clearLongPressTimer();
      draggingRef.current.moved = true;
      const clamped = clampPosition(
        draggingRef.current.initialX + dx,
        draggingRef.current.initialY + dy,
        adaptiveBubbleSize,
      );
      latestBubblePositionRef.current = clamped;
      setBubblePosition(clamped.x, clamped.y);
    };

    const onUp = (upEvent: PointerEvent) => {
      if (draggingRef.current.pointerId !== upEvent.pointerId) {
        return;
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.style.userSelect = previousUserSelect;
      clearLongPressTimer();

      try {
        target.releasePointerCapture(upEvent.pointerId);
      } catch {
        // pointer capture not active
      }

      if (longPressTriggeredRef.current) {
        setBubbleState('idle');
        draggingRef.current.pointerId = -1;
        return;
      }

      if (!draggingRef.current.moved) {
        toggleOpen();
        draggingRef.current.pointerId = -1;
        return;
      }

      const current = clampPosition(
        latestBubblePositionRef.current.x,
        latestBubblePositionRef.current.y,
        adaptiveBubbleSize,
      );
      const preferred = getPreferredCorner(cornerStatsRef.current);
      const snap = chooseSmartSnapPosition(current, adaptiveBubbleSize, preferred);
      latestBubblePositionRef.current = snap.position;
      setBubblePosition(snap.position.x, snap.position.y);
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(snap.position));

      const bounds = getBounds(adaptiveBubbleSize);
      const snapCorner = detectCornerForPosition(snap.position, bounds);
      const nextStats = {
        ...cornerStatsRef.current,
        [snapCorner]: (cornerStatsRef.current[snapCorner] ?? 0) + 1,
      };
      cornerStatsRef.current = nextStats;
      setCornerStats(nextStats);
      saveCornerStats(nextStats);

      if (preferencesQuery.data) {
        const hasPositionChange =
          Math.abs((preferencesQuery.data.bubblePositionX ?? 0) - snap.position.x) > 0.5 ||
          Math.abs((preferencesQuery.data.bubblePositionY ?? 0) - snap.position.y) > 0.5;
        if (hasPositionChange) {
          savePreferencesMutation.mutate({
            ...preferencesQuery.data,
            bubblePositionX: snap.position.x,
            bubblePositionY: snap.position.y,
          });
        }
      }

      appendTimeline('Balon konumu güncellendi', 'done', snapCorner);
      draggingRef.current.pointerId = -1;
    };

    const onCancel = (cancelEvent: PointerEvent) => {
      if (draggingRef.current.pointerId !== cancelEvent.pointerId) {
        return;
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.style.userSelect = previousUserSelect;
      clearLongPressTimer();
      draggingRef.current.pointerId = -1;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [
    adaptiveBubbleSize,
    appendTimeline,
    bubbleX,
    bubbleY,
    clearLongPressTimer,
    commandWheelOpen,
    preferencesQuery.data,
    savePreferencesMutation,
    setBubblePosition,
    setBubbleState,
    toggleOpen,
  ]);

  if (preferencesQuery.data === null) {
    return null;
  }

  return (
    <>
      <AssistantBubble
        x={bubbleX}
        y={bubbleY}
        size={adaptiveBubbleSize}
        state={bubbleState}
        animationLevel={preference.animationLevel}
        unreadCount={unreadCount}
        isOpen={isOpen}
        onPointerDown={handleBubblePointerDown}
        onToggle={toggleOpen}
      />

      <AssistantCommandWheel
        open={commandWheelOpen}
        x={bubbleX}
        y={bubbleY}
        bubbleSize={adaptiveBubbleSize}
        onClose={() => {
          setCommandWheelOpen(false);
          setBubbleState('idle');
        }}
        onSelect={(item: CommandWheelAction) => {
          setCommandWheelOpen(false);
          if (item.quickActionKey === 'open_mail_page') {
            router.push('/dashboard/mail');
            appendTimeline('Hızlı komut çalıştı', 'done', 'Mail sayfası açıldı');
            return;
          }
          void sendMessage(item.prompt, item.quickActionKey);
        }}
      />

      <AssistantPanel
        open={isOpen}
        assistantName={assistantName}
        statusLabel={statusLabel}
        isTyping={isTyping || Boolean(streamingMessageId)}
        userName={userName}
        conversations={conversationList}
        activeConversationId={activeConversationId}
        messages={localMessages}
        quickActions={quickActions}
        liveTimeline={liveTimeline}
        memoryItems={memoryItems}
        auditLogs={auditLogs}
        preference={preferencesQuery.data ?? null}
        pendingAction={pendingAction}
        confirmingAction={isConfirmingAction}
        savingPreferences={savePreferencesMutation.isPending}
        loadingMemory={memoryQuery.isFetching || memoryCreateMutation.isPending || memoryDeleteMutation.isPending}
        tab={tab}
        onClose={() => setOpen(false)}
        onSetTab={setTab}
        onNewConversation={() => {
          void newConversationMutation.mutateAsync();
        }}
        onConversationSelect={(id) => {
          setActiveConversationId(id);
          setLocalMessages([]);
        }}
        onQuickAction={(item) => {
          void sendMessage(item.prompt, item.key);
        }}
        onSendMessage={(message) => {
          void sendMessage(message);
        }}
        onVoiceClick={handleVoiceClick}
        onPreferenceSave={(next) => {
          void savePreferencesMutation.mutateAsync(next);
        }}
        onMemoryCreate={(payload) => {
          void memoryCreateMutation.mutateAsync(payload);
        }}
        onMemoryDelete={(id) => {
          void memoryDeleteMutation.mutateAsync(id);
        }}
        onPendingCancel={() => {
          void handlePendingCancel();
        }}
        onPendingConfirm={() => {
          void handlePendingConfirm();
        }}
        onGoTasks={() => router.push('/dashboard/tasks?openTask=1')}
        onGoHukukAi={() => router.push('/tools/hukuk-ai')}
      />

      {undoOption && undoSecondsLeft > 0 ? (
        <AssistantUndoBanner
          label={undoOption.label}
          secondsLeft={undoSecondsLeft}
          onUndo={() => {
            void handleUndo();
          }}
          onDismiss={() => {
            setUndoOption(null);
            setUndoDeadline(null);
          }}
        />
      ) : null}

      {proactiveSignal ? (
        <div className="fixed bottom-20 right-4 z-[65] max-w-[340px] rounded-xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-1,var(--surface))] p-3 shadow-[0_20px_40px_-30px_rgba(15,23,42,0.65)]">
          <p className="text-xs text-[var(--main-text,var(--text))]">{proactiveSignal.message}</p>
          {proactiveSignal.suggestion ? (
            <p className="mt-1 text-[11px] text-[var(--main-muted,var(--secondary))]">{proactiveSignal.suggestion}</p>
          ) : null}
          <div className="mt-2 flex items-center justify-end gap-2">
            {proactiveSignal.route ? (
              <button
                type="button"
                className="rounded-md border border-[color-mix(in_srgb,var(--primary),white_35%)] bg-[color-mix(in_srgb,var(--primary),white_88%)] px-2 py-1 text-[11px] font-semibold text-[var(--primary)]"
                onClick={() => {
                  router.push(proactiveSignal.route as Parameters<typeof router.push>[0]);
                  setProactiveSignal(null);
                }}
              >
                Aç
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setProactiveSignal(null)}
              className="rounded-md border border-[var(--main-border,var(--border))] px-2 py-1 text-[11px] text-[var(--main-muted,var(--secondary))]"
            >
              Kapat
            </button>
          </div>
        </div>
      ) : null}

      {lastError ? (
        <div
          className={cn(
            'fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-full border border-rose-300 bg-white px-3 py-1 text-xs text-rose-700 shadow',
          )}
        >
          {lastError}
        </div>
      ) : null}
    </>
  );
}
