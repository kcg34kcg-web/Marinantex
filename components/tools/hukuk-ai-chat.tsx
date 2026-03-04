'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BrainCircuit,  
  Paperclip,
  Copy,
  PenLine,
  ThumbsUp,
  ThumbsDown,
  BookOpen,
  Menu,
  Plus,
  AlertTriangle,
  Info,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Scale,
  CalendarDays,
  Send,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AssistantMemoryPanel } from '@/components/tools/assistant-memory-panel';
import { SourceSplitViewer } from '@/components/tools/source-split-viewer';
import {
  AiTier,
  ClientAction,
  ChatMode,
  RagFeatureFlagsV1,
  RagQueryRequestV3,
  RagResponseV3,
  RagSaveRequestV3,
  RagSaveResponseV3,
  ResponseDepth,
  ResponseType,
  SaveMode,
  SaveTarget,
  TemporalFields,
} from '@/types';

// --- Types (mirror backend RAGResponse) ------------------------------------

interface Source {
  id?: string;
  doc_id?: string;
  title?: string;
  citation?: string;
  source_type?: string;
  source_origin?: string;
  content: string;
  court_level?: string;
  court?: string;
  madde_no?: string;
  article_no?: string;
  source_anchor?: string;
  page_no?: number;
  char_start?: number;
  char_end?: number;
  source_url?: string;
  authority_score?: number;
  final_score?: number;
  recency_score?: number;
  support_span?: number;
  citation_confidence?: number;
  quality_source_class?: string;
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
  tier: number;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
  cached: boolean;
  rate_per_1m_in: number;
  rate_per_1m_out: number;
}

interface RagResponse extends RagResponseV3 {
  sources: Source[];
  answer_sentences: AnswerSentence[];
  tier?: number;
  legal_disclaimer?: LegalDisclaimer;
  temporal_fields?: TemporalFields;
  lehe_kanun_notice?: LeheNotice;
  cost_estimate?: CostEstimate;
  aym_warnings?: { doc_id: string; warning_text: string }[];
}

interface RagUiError {
  message: string;
  code?: string;
  suggestions?: string[];
  intentClass?: string;
  strictGrounding?: boolean;
}

interface UploadedDocumentItem {
  doc_id: string;
  file_name: string;
  selected: boolean;
  warnings: string[];
}

interface ThreadBootstrapResponse {
  thread_id: string;
  user_message_id: string;
  case_id?: string | null;
}

interface ThreadAssistantResponse {
  thread_id: string;
  assistant_message_id: string;
}

interface UploadDocumentResponse {
  doc_id: string;
  file_name: string;
  warnings?: string[];
}

interface ThreadMessageItem {
  id: string;
  role: 'user' | 'assistant' | string;
  content: string;
  created_at?: string;
  model_used?: string | null;
}

interface SavedOutputItem {
  id: string;
  title?: string | null;
  content?: string | null;
  output_type?: string | null;
  output_kind?: string | null;
  case_id?: string | null;
  version_no?: number | null;
  parent_output_id?: string | null;
  is_final?: boolean | null;
  created_at?: string | null;
}

interface ClientDraftItem {
  id: string;
  status: 'draft' | 'approved' | 'archived' | string;
  title?: string | null;
  contentPreview?: string | null;
  updatedAt?: string | null;
}

type AssistantFeedbackReaction = 'like' | 'dislike';

// --- Tier badge ------------------------------------------------------------

const TIER_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: 'Hazır Cevap', color: 'bg-emerald-100 text-emerald-800' },
  2: { label: 'Düşünceli', color: 'bg-blue-100 text-blue-800' },
  3: { label: 'Uzman', color: 'bg-indigo-100 text-indigo-800' },
  4: { label: 'Muazzam', color: 'bg-amber-100 text-amber-800' },
};

const TIER_OPTIONS: Array<{
  value: AiTier;
  tier: number;
  label: string;
  description: string;
  modelHint: string;
  badgeColor: string;
}> = [
  {
    value: AiTier.HAZIR_CEVAP,
    tier: 1,
    label: 'Hazır Cevap',
    description: 'Anlık hızlı taslak',
    modelHint: 'Gemini 2.0 Flash',
    badgeColor: 'bg-emerald-100 text-emerald-800',
  },
  {
    value: AiTier.DUSUNCELI,
    tier: 2,
    label: 'Düşünceli',
    description: 'Hız-doğruluk dengesi',
    modelHint: 'Gemini 2.0 Flash',
    badgeColor: 'bg-blue-100 text-blue-800',
  },
  {
    value: AiTier.UZMAN,
    tier: 3,
    label: 'Uzman',
    description: 'Kaynaklı uzman analiz',
    modelHint: 'OpenAI (gpt-4o)',
    badgeColor: 'bg-indigo-100 text-indigo-800',
  },
  {
    value: AiTier.MUAZZAM,
    tier: 4,
    label: 'Muazzam',
    description: 'Maksimum kapsam ve derinlik',
    modelHint: 'OpenAI (gpt-4.1)',
    badgeColor: 'bg-amber-100 text-amber-800',
  },
];

type LeftPaneTab = 'files' | 'history' | 'search' | 'templates';
type InspectorTab = 'sources' | 'documents' | 'research' | 'settings';

const TEMPLATE_PROMPTS = [
  'Tahliye taahhutnamesi gecerlilik sartlarini ve Yargitay kriterlerini acikla.',
  'Rekabet yasagi sozlesmesi icin hukuka uygunluk checklisti hazirla.',
  'Ihtarname taslagi icin zorunlu maddeleri adim adim sirala.',
  'Is sozlesmesi feshi oncesi risk analizi sorulari uret.',
];

type UploadStage = 'idle' | 'yukleniyor' | 'metin_cikariliyor' | 'indeksleniyor' | 'hazir' | 'iptal_edildi';
type ResearchStage = 'arastiriliyor' | 'emsal_araniyor' | 'derleniyor' | 'kaynaklar_hazirlaniyor';

const RESEARCH_STAGE_ORDER: ResearchStage[] = [
  'arastiriliyor',
  'emsal_araniyor',
  'derleniyor',
  'kaynaklar_hazirlaniyor',
];

const RESEARCH_STAGE_LABEL: Record<ResearchStage, string> = {
  arastiriliyor: 'Arastiriliyor',
  emsal_araniyor: 'Emsal araniyor',
  derleniyor: 'Derleniyor',
  kaynaklar_hazirlaniyor: 'Kaynaklar hazirlaniyor',
};

const UPLOAD_STAGE_LABEL: Record<UploadStage, string> = {
  idle: 'Hazir',
  yukleniyor: 'Yukleniyor',
  metin_cikariliyor: 'Metin cikariliyor',
  indeksleniyor: 'Indeksleniyor',
  hazir: 'Hazir',
  iptal_edildi: 'Iptal edildi',
};

const UPLOAD_STAGE_ORDER: UploadStage[] = ['yukleniyor', 'metin_cikariliyor', 'indeksleniyor', 'hazir'];

// --- Component -------------------------------------------------------------

const CHAT_MODE_LABELS: Record<ChatMode, string> = {
  [ChatMode.GENERAL_CHAT]: 'Genel Mod',
  [ChatMode.DOCUMENT_ANALYSIS]: 'Belgeli Mod',
};

const RESPONSE_TYPE_LABELS: Record<ResponseType, { label: string; color: string }> = {
  [ResponseType.LEGAL_GROUNDED]: {
    label: 'Kaynaklı Hukuki Yanıt',
    color: 'bg-emerald-100 text-emerald-800',
  },
  [ResponseType.SOCIAL_UNGROUNDED]: {
    label: 'Sosyal / Kaynaksız Yanıt',
    color: 'bg-slate-100 text-slate-600',
  },
};

const CITATION_STRENGTH_COLOR: Record<string, string> = {
  Yuksek: 'text-green-700',
  Orta: 'text-amber-700',
  Dusuk: 'text-red-700',
};

const SOURCE_CLASS_LABEL: Record<string, string> = {
  kanun: 'Kanun',
  ictihat: 'Ictihat',
  ikincil_kaynak: 'Ikincil',
  kullanici_notu: 'Kullanici',
};

const DEFAULT_FEATURE_FLAGS: RagFeatureFlagsV1 = {
  strict_grounding_v2: true,
  tier_selector_ui: true,
  router_hybrid_v3: true,
  save_targets_v2: true,
  client_translator_draft: true,
  memory_dashboard_v1: false,
};

const COMPOSER_MIN_VISIBLE_LINES = 3;
const COMPOSER_MAX_VISIBLE_LINES = 6;

const DISLIKE_REASON_OPTIONS = [
  { value: 'alakasiz', label: 'Alakasiz' },
  { value: 'yanlis', label: 'Yanlis' },
  { value: 'eksik', label: 'Eksik' },
  { value: 'belirsiz', label: 'Belirsiz' },
  { value: 'diger', label: 'Diger' },
] as const;

export function HukukAiChat() {
  const currentUiPhase = Number(process.env.NEXT_PUBLIC_HUKUK_CHAT_UI_PHASE ?? '1');
  const [chatMode, setChatMode] = useState<ChatMode>(ChatMode.GENERAL_CHAT);
  const [selectedTier, setSelectedTier] = useState<AiTier>(AiTier.DUSUNCELI);
  const [query, setQuery] = useState('');
  const [lastSubmittedQuery, setLastSubmittedQuery] = useState('');
  const [queryCaseId, setQueryCaseId] = useState('');
  const [asOfDate, setAsOfDate] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [decisionDate, setDecisionDate] = useState('');
  const [showDateFields, setShowDateFields] = useState(false);
  const [leftPaneTab, setLeftPaneTab] = useState<LeftPaneTab>('files');
  const [leftSearchTerm, setLeftSearchTerm] = useState('');
  const [leftPaneOpen, setLeftPaneOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('sources');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [hasSentFirstQuery, setHasSentFirstQuery] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<RagResponse | null>(null);
  const [error, setError] = useState<RagUiError | null>(null);
  const [expandedSources, setExpandedSources] = useState(false);
  const [splitViewOpen, setSplitViewOpen] = useState(false);
  const [activeSourceIndex, setActiveSourceIndex] = useState<number | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [sourceUserMessageId, setSourceUserMessageId] = useState<string | null>(null);
  const [sourceAssistantMessageId, setSourceAssistantMessageId] = useState<string | null>(null);
  const [lastUserMessageId, setLastUserMessageId] = useState<string | null>(null);
  const [lastAssistantMessageId, setLastAssistantMessageId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessageItem[]>([]);
  const [savedOutputs, setSavedOutputs] = useState<SavedOutputItem[]>([]);
  const [clientDrafts, setClientDrafts] = useState<ClientDraftItem[]>([]);
  const [lastSavedOutputId, setLastSavedOutputId] = useState<string | null>(null);
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocumentItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle');
  const [uploadProgressPct, setUploadProgressPct] = useState(0);
  const [showUploadProgress, setShowUploadProgress] = useState(false);
  const [researchStage, setResearchStage] = useState<ResearchStage | null>(null);
  const [showResearchProgress, setShowResearchProgress] = useState(false);
  const [saveCaseId, setSaveCaseId] = useState('');
  const [newCaseTitle, setNewCaseTitle] = useState('');
  const [clientDraftTitle, setClientDraftTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [introHeadline, setIntroHeadline] = useState('');
  const [showIntroGavelHit, setShowIntroGavelHit] = useState(false);
  const [sendButtonAnimation, setSendButtonAnimation] = useState(0);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [copyState, setCopyState] = useState<'user' | 'assistant' | null>(null);
  const [assistantFeedback, setAssistantFeedback] = useState<AssistantFeedbackReaction | null>(null);
  const [showDislikeReasons, setShowDislikeReasons] = useState(false);
  const [selectedDislikeReason, setSelectedDislikeReason] = useState<string | null>(null);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [isComposerScrollable, setIsComposerScrollable] = useState(false);
  const [isEditingUserMessage, setIsEditingUserMessage] = useState(false);
  const [editingUserQuery, setEditingUserQuery] = useState('');
  const [featureFlags, setFeatureFlags] = useState<RagFeatureFlagsV1>(DEFAULT_FEATURE_FLAGS);
  const [flagsLoading, setFlagsLoading] = useState(true);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const inlineEditTextareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadProgressDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const researchProgressDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const researchStageIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const copyStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadFeatureFlags() {
      setFlagsLoading(true);
      try {
        const response = await fetch('/api/rag/feature-flags', { method: 'GET' });
        const payload = (await response.json()) as {
          flags?: Partial<RagFeatureFlagsV1>;
        };

        if (!isMounted) return;

        if (response.ok && payload.flags) {
          setFeatureFlags({
            ...DEFAULT_FEATURE_FLAGS,
            ...payload.flags,
          });
        } else {
          setFeatureFlags(DEFAULT_FEATURE_FLAGS);
        }
      } catch {
        if (!isMounted) return;
        setFeatureFlags(DEFAULT_FEATURE_FLAGS);
      } finally {
        if (isMounted) setFlagsLoading(false);
      }
    }

    void loadFeatureFlags();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (modeMenuRef.current && !modeMenuRef.current.contains(event.target as Node)) {
        setIsModeMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsModeMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    if (currentUiPhase !== 1) return;

    const introText = 'Bugün Ne Araştırıyoruz?';
    let index = 0;
    let gavelTimer: ReturnType<typeof setTimeout> | null = null;

    setIntroHeadline('');
    setShowIntroGavelHit(false);

    const writer = setInterval(() => {
      index += 1;
      setIntroHeadline(introText.slice(0, index));

      if (index >= introText.length) {
        clearInterval(writer);
        gavelTimer = setTimeout(() => setShowIntroGavelHit(true), 220);
      }
    }, 56);

    return () => {
      clearInterval(writer);
      if (gavelTimer) clearTimeout(gavelTimer);
    };
  }, [currentUiPhase]);

  useEffect(() => {
    if (!featureFlags.tier_selector_ui && selectedTier !== AiTier.HAZIR_CEVAP) {
      setSelectedTier(AiTier.HAZIR_CEVAP);
    }
  }, [featureFlags.tier_selector_ui, selectedTier]);

  useEffect(() => {
    void loadSavedOutputs();
    void loadClientDrafts();
  }, []);

  useEffect(() => {
    if (!threadId) {
      setThreadMessages([]);
      return;
    }
    void loadThreadMessages(threadId);
  }, [threadId]);

  useEffect(() => {
    return () => {
      if (uploadProgressDelayRef.current) {
        clearTimeout(uploadProgressDelayRef.current);
      }
      if (researchProgressDelayRef.current) {
        clearTimeout(researchProgressDelayRef.current);
      }
      if (researchStageIntervalRef.current) {
        clearInterval(researchStageIntervalRef.current);
      }
      if (copyStateTimerRef.current) {
        clearTimeout(copyStateTimerRef.current);
      }
      if (uploadProgressTimeoutRef.current) {
        clearTimeout(uploadProgressTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    syncComposerHeight();
  }, [query, currentUiPhase]);

  useEffect(() => {
    if (!isEditingUserMessage) return;    
    const timeoutId = setTimeout(() => {
      const textarea = inlineEditTextareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [isEditingUserMessage]);

  function normalizeError(payload: unknown): RagUiError {
    if (!payload || typeof payload !== 'object') {
      return { message: 'Bir hata olustu.' };
    }

    const body = payload as Record<string, unknown>;
    const code = typeof body.error_code === 'string' ? body.error_code : undefined;
    const message =
      typeof body.message === 'string'
        ? body.message
        : typeof body.error === 'string'
          ? body.error
          : typeof body.detail === 'string'
            ? body.detail
            : 'Bir hata olustu.';

    if (code === 'NO_SOURCE_HARD_FAIL') {
      const suggestions = Array.isArray(body.suggestions)
        ? body.suggestions.filter((value): value is string => typeof value === 'string')
        : [];

      return {
        message,
        code,
        suggestions,
        intentClass: typeof body.intent_class === 'string' ? body.intent_class : undefined,
        strictGrounding: typeof body.strict_grounding === 'boolean' ? body.strict_grounding : true,
      };
    }

    if (code === 'REQUESTED_TIER_UNAVAILABLE_NO_DOWNGRADE') {
      const requestedTier = typeof body.requested_tier === 'number' ? body.requested_tier : null;
      if (requestedTier === 1 || requestedTier === 2) {
        return {
          code,
          message:
            'Hazir Cevap / Dusunceli seciminde Gemini 2.0 Flash zorunludur. GOOGLE_API_KEY eksik veya gecersiz.',
        };
      }
      if (requestedTier === 3 || requestedTier === 4) {
        return {
          code,
          message:
            'Uzman / Muazzam seciminde OpenAI modeli zorunludur. OPENAI_API_KEY veya tier model ayarlari kontrol edilmeli.',
        };
      }
    }

    return { message, code };
  }

  function isTextLikeUpload(file: File): boolean {
    if (file.type.startsWith('text/')) return true;
    const name = file.name.toLowerCase();
    return ['.txt', '.md', '.json', '.xml', '.csv', '.log', '.html', '.htm', '.rtf', '.pdf', '.doc', '.docx'].some((ext) =>
      name.endsWith(ext),
    );
  }

  function activeDocumentIds(): string[] {
    return uploadedDocuments.filter((doc) => doc.selected).map((doc) => doc.doc_id);
  }

  function scheduleUploadProgressReveal() {
    if (uploadProgressDelayRef.current) {
      clearTimeout(uploadProgressDelayRef.current);
    }
    setShowUploadProgress(false);
    uploadProgressDelayRef.current = setTimeout(() => {
      setShowUploadProgress(true);
    }, 260);
  }

  function startResearchProgressFlow() {
    if (researchProgressDelayRef.current) {
      clearTimeout(researchProgressDelayRef.current);
    }
    if (researchStageIntervalRef.current) {
      clearInterval(researchStageIntervalRef.current);
    }

    setShowResearchProgress(false);
    setResearchStage(null);

    researchProgressDelayRef.current = setTimeout(() => {
      setShowResearchProgress(true);
      setResearchStage('arastiriliyor');
      researchStageIntervalRef.current = setInterval(() => {
        setResearchStage((prev) => {
          if (!prev) return RESEARCH_STAGE_ORDER[0];
          const currentIndex = RESEARCH_STAGE_ORDER.indexOf(prev);
          if (currentIndex === -1 || currentIndex >= RESEARCH_STAGE_ORDER.length - 1) {
            return RESEARCH_STAGE_ORDER[RESEARCH_STAGE_ORDER.length - 1];
          }
          return RESEARCH_STAGE_ORDER[currentIndex + 1];
        });
      }, 1200);
    }, 300);
  }

  function stopResearchProgressFlow() {
    if (researchProgressDelayRef.current) {
      clearTimeout(researchProgressDelayRef.current);
      researchProgressDelayRef.current = null;
    }
    if (researchStageIntervalRef.current) {
      clearInterval(researchStageIntervalRef.current);
      researchStageIntervalRef.current = null;
    }
    setShowResearchProgress(false);
    setResearchStage(null);
  }

  function handleCancelUpload() {
    if (uploadAbortControllerRef.current) {
      uploadAbortControllerRef.current.abort();
    }
    setUploadStage('iptal_edildi');
    setUploadError('Belge yukleme islemi kullanici tarafindan durduruldu.');
    setIsUploading(false);
    setShowUploadProgress(true);
  }

  function triggerSendAnimation() {
    setSendButtonAnimation((value) => value + 1);
  }

  function preferredScrollBehavior(): ScrollBehavior {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 'auto';
    }
    return 'smooth';
  }

  function syncComposerHeight() {
    const textarea = composerTextareaRef.current;
    if (!textarea || typeof window === 'undefined') return;

    textarea.style.height = 'auto';
    const computed = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computed.lineHeight || '') || 22;
    const verticalPadding =
      (Number.parseFloat(computed.paddingTop || '') || 0) + (Number.parseFloat(computed.paddingBottom || '') || 0);
    const borderWidth =
      (Number.parseFloat(computed.borderTopWidth || '') || 0) + (Number.parseFloat(computed.borderBottomWidth || '') || 0);
    const minHeight = lineHeight * COMPOSER_MIN_VISIBLE_LINES + verticalPadding + borderWidth;
    const maxHeight = lineHeight * COMPOSER_MAX_VISIBLE_LINES + verticalPadding + borderWidth;
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, textarea.scrollHeight));
    const shouldScroll = textarea.scrollHeight > maxHeight + 1;

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = shouldScroll ? 'auto' : 'hidden';
    setIsComposerScrollable(shouldScroll);
  }

  function scrollComposerContent(direction: 'up' | 'down') {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    const top = direction === 'up' ? -96 : 96;
    textarea.scrollBy({ top, behavior: preferredScrollBehavior() });
    textarea.focus();
  }

  async function copyMessageContent(target: 'user' | 'assistant', text: string) {
    const normalizedText = text.trim();
    if (!normalizedText) return;

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalizedText);
      } else if (typeof document !== 'undefined') {
        const fallback = document.createElement('textarea');
        fallback.value = normalizedText;
        fallback.style.position = 'fixed';
        fallback.style.left = '-9999px';
        document.body.appendChild(fallback);
        fallback.focus();
        fallback.select();
        document.execCommand('copy');
        document.body.removeChild(fallback);
      }

      setCopyState(target);
      if (copyStateTimerRef.current) clearTimeout(copyStateTimerRef.current);
      copyStateTimerRef.current = setTimeout(() => setCopyState(null), 1400);
    } catch {
      setFeedbackError('Metin panoya kopyalanamadi.');
    }
  }

  async function submitAssistantFeedback(reaction: AssistantFeedbackReaction, reasonCode?: string) {
    if (!threadId || !lastAssistantMessageId) {
      setFeedbackError('Geri bildirim icin mesaj kimligi bulunamadi.');
      return;
    }

    setFeedbackPending(true);
    setFeedbackError(null);

    try {
      const response = await fetch('/api/rag/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: threadId,
          message_id: lastAssistantMessageId,
          reaction,
          reason_code: reasonCode,
        }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setFeedbackError(data.error ?? 'Geri bildirim kaydi basarisiz oldu.');
        return;
      }

      setAssistantFeedback(reaction);
      if (reaction === 'dislike') {
        setSelectedDislikeReason(reasonCode ?? null);
      } else {
        setSelectedDislikeReason(null);
        setShowDislikeReasons(false);
      }
    } catch {
      setFeedbackError('Geri bildirim servisine ulasilamadi.');
    } finally {
      setFeedbackPending(false);
    }
  }

  async function bootstrapThread(userMessage: string, normalizedCaseId?: string): Promise<ThreadBootstrapResponse | null> {
    try {
      const response = await fetch('/api/rag/thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bootstrap',
          thread_id: threadId ?? undefined,
          chat_mode: chatMode,
          case_id: normalizedCaseId || undefined,
          user_message: userMessage,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return null;
      }
      return data as ThreadBootstrapResponse;
    } catch {
      return null;
    }
  }

  async function loadThreadMessages(targetThreadId: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/rag/thread?thread_id=${encodeURIComponent(targetThreadId)}`, {
        method: 'GET',
      });
      const payload = (await response.json()) as { messages?: ThreadMessageItem[] };
      if (!response.ok) return false;
      setThreadMessages(Array.isArray(payload.messages) ? payload.messages : []);
      return true;
    } catch {
      return false;
    }
  }

  async function loadSavedOutputs() {
    try {
      const response = await fetch('/api/rag/saved?limit=50', { method: 'GET' });
      const payload = (await response.json()) as { items?: SavedOutputItem[] };
      if (!response.ok) return;
      setSavedOutputs(Array.isArray(payload.items) ? payload.items : []);
    } catch {
      // non-fatal
    }
  }

  async function loadClientDrafts() {
    try {
      const response = await fetch('/api/dashboard/clients/drafts?limit=20', { method: 'GET' });
      const payload = (await response.json()) as { drafts?: ClientDraftItem[] };
      if (!response.ok) return;
      setClientDrafts(Array.isArray(payload.drafts) ? payload.drafts : []);
    } catch {
      // non-fatal
    }
  }

  async function persistAssistantMessage(
    targetThreadId: string | null,
    assistantAnswer: string,
    responseType: ResponseType,
    modelUsed?: string,
    sourceCount?: number,
    auditTrailId?: string,
  ): Promise<ThreadAssistantResponse | null> {
    if (!targetThreadId) return null;
    try {
      const response = await fetch('/api/rag/thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'append_assistant',
          thread_id: targetThreadId,
          assistant_message: assistantAnswer,
          response_type: responseType,
          model_used: modelUsed,
          source_count: sourceCount ?? 0,
          metadata: {
            audit_trail_id: auditTrailId,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return null;
      }
      return data as ThreadAssistantResponse;
    } catch {
      return null;
    }
  }

  async function handleDocumentUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    const normalizedCaseId = queryCaseId.trim();
    if (normalizedCaseId && !isUuid(normalizedCaseId)) {
      setUploadError('Belge yuklemek icin once gecerli bir Case UUID girin veya alani bos birakin.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    const abortController = new AbortController();
    uploadAbortControllerRef.current = abortController;

    setUploadStage('yukleniyor');
    setUploadProgressPct(8);
    scheduleUploadProgressReveal();
    const softErrors: string[] = [];
    const totalFiles = files.length;

    for (const [index, file] of files.entries()) {      
      if (abortController.signal.aborted) break;

      const baseProgress = Math.round((index / totalFiles) * 100);
      setUploadStage('yukleniyor');
      setUploadProgressPct(Math.max(8, baseProgress));

      if (!isTextLikeUpload(file)) {        
        softErrors.push(`${file.name}: metin tabanli dosya degil.`);
        continue;
      }

      try {        
        if (abortController.signal.aborted) break;
        setUploadStage('metin_cikariliyor');
        setUploadProgressPct(Math.min(94, baseProgress + 25));

        if (abortController.signal.aborted) break;
        setUploadStage('indeksleniyor');
        setUploadProgressPct(Math.min(96, baseProgress + 70));

        const formData = new FormData();
        formData.append('file', file);
        formData.append('file_name', file.name);
        if (normalizedCaseId) formData.append('case_id', normalizedCaseId);
        formData.append('citation', `Yuklenen belge: ${file.name}`);

        const response = await fetch('/api/rag/upload', {
          method: 'POST',
          body: formData,
          signal: abortController.signal,
        });
        const data = await response.json();

        if (!response.ok || typeof data?.doc_id !== 'string') {
          const message =
            typeof data?.error === 'string'
              ? data.error
              : 'Belge ingest basarisiz oldu.';
          softErrors.push(`${file.name}: ${message}`);
          continue;
        }

        const payload = data as UploadDocumentResponse;
        const warnings = Array.isArray(payload.warnings)
          ? payload.warnings.filter((value): value is string => typeof value === 'string')
          : [];

        setUploadedDocuments((prev) => {
          const deduped = prev.filter((item) => item.doc_id !== payload.doc_id);
          return [
            {
              doc_id: payload.doc_id,
              file_name: payload.file_name || file.name,
              selected: true,
              warnings,
            },
            ...deduped,
          ];
        });
        const completedProgress = Math.round(((index + 1) / totalFiles) * 100);
        setUploadProgressPct(Math.min(99, completedProgress));
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          softErrors.push(`${file.name}: Yukleme iptal edildi.`);
        } else {
          softErrors.push(`${file.name}: upload sirasinda ag hatasi olustu.`);
        }
      }
    }

    if (abortController.signal.aborted) {
      setUploadStage('iptal_edildi');
    } else {      
      setUploadStage('hazir');
      setUploadProgressPct(100);
    }

    if (softErrors.length > 0) {
      setUploadError(softErrors.join(' | '));
    }

    if (!abortController.signal.aborted) {
      if (uploadProgressTimeoutRef.current) clearTimeout(uploadProgressTimeoutRef.current);
      uploadProgressTimeoutRef.current = setTimeout(() => {
        setShowUploadProgress(false);
      }, 1200);
    }
    setIsUploading(false);
  }

  async function submitQuery(rawQuery: string) {
    const normalizedQuery = rawQuery.trim();
    if (!normalizedQuery) return;

    const normalizedCaseId = queryCaseId.trim();
    if (normalizedCaseId && !isUuid(normalizedCaseId)) {
      setError({ message: 'Case UUID formati gecersiz.' });
      return;
    }

    if (currentUiPhase === 1) {
      triggerSendAnimation();
    }

    setLastSubmittedQuery(normalizedQuery);
    setQuery('');
    setIsEditingUserMessage(false);
    setEditingUserQuery('');
    setHasSentFirstQuery(true);
    setIsLoading(true);
    setError(null);
    setSaveError(null);
    setSaveSuccess(null);
    setUploadError(null);
    setFeedbackError(null);
    setAssistantFeedback(null);
    setShowDislikeReasons(false);
    setSelectedDislikeReason(null);
    setSourceUserMessageId(null);
    setSourceAssistantMessageId(null);
    setLastUserMessageId(null);
    setLastAssistantMessageId(null);
    setSplitViewOpen(false);
    setActiveSourceIndex(null);
    startResearchProgressFlow();

    try {
      let effectiveThreadId = threadId;
      let effectiveSourceMessageId: string | null = null;
      let loadedFromThreadApi = false;
      const bootstrap = await bootstrapThread(normalizedQuery, normalizedCaseId || undefined);
      if (bootstrap) {
        effectiveThreadId = bootstrap.thread_id;
        effectiveSourceMessageId = bootstrap.user_message_id;
        setThreadId(bootstrap.thread_id);
        setSourceUserMessageId(bootstrap.user_message_id);
        setLastUserMessageId(bootstrap.user_message_id);
        loadedFromThreadApi = await loadThreadMessages(bootstrap.thread_id);
      }
      if (!loadedFromThreadApi) {
        setThreadMessages((prev) => [
          ...prev,
          {
            id: `local-user-${Date.now()}`,
            role: 'user',
            content: normalizedQuery,
            created_at: new Date().toISOString(),
          },
        ]);
      }
      if (!saveCaseId.trim() && normalizedCaseId) {
        setSaveCaseId(normalizedCaseId);
      }

      const payload: RagQueryRequestV3 = {
        query: normalizedQuery,
        chat_mode: chatMode,
        ai_tier: featureFlags.tier_selector_ui ? selectedTier : AiTier.HAZIR_CEVAP,
        response_depth: ResponseDepth.STANDARD,
        strict_grounding: featureFlags.strict_grounding_v2,
      };
      const recentHistory = threadMessages
        .filter((message) => (message.role === 'user' || message.role === 'assistant') && Boolean(message.content?.trim()))
        .slice(-10)
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: message.content.trim().slice(0, 1200),
        }));
      if (recentHistory.length > 0) payload.history = recentHistory;
      if (effectiveThreadId) payload.thread_id = effectiveThreadId;
      if (normalizedCaseId) payload.case_id = normalizedCaseId;
      if (chatMode === ChatMode.DOCUMENT_ANALYSIS) {
        const activeDocs = activeDocumentIds();
        if (activeDocs.length > 0) payload.active_document_ids = activeDocs;
      }
      if (asOfDate) payload.as_of_date = asOfDate;
      if (eventDate) payload.event_date = eventDate;
      if (decisionDate) payload.decision_date = decisionDate;

      const res = await fetch('/api/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(normalizeError(data));
      } else {
        const nextResult = data as RagResponse;
        setResult(nextResult);

        const assistantPersist = await persistAssistantMessage(
          effectiveThreadId,
          nextResult.answer,
          nextResult.response_type,
          nextResult.model_used,
          nextResult.sources?.length ?? 0,
          nextResult.audit_trail_id,
        );
        if (assistantPersist?.assistant_message_id) {
          setSourceAssistantMessageId(assistantPersist.assistant_message_id);
          setLastAssistantMessageId(assistantPersist.assistant_message_id);
          if (effectiveThreadId) {
            const loaded = await loadThreadMessages(effectiveThreadId);
            if (!loaded) {
              setThreadMessages((prev) => [
                ...prev,
                {
                  id: `local-assistant-${Date.now()}`,
                  role: 'assistant',
                  content: nextResult.answer,
                  created_at: new Date().toISOString(),
                  model_used: nextResult.model_used ?? null,
                },
              ]);
            }
          }
        } else if (effectiveSourceMessageId) {
          setSourceAssistantMessageId(null);
          setLastAssistantMessageId(null);
          setThreadMessages((prev) => [
            ...prev,
            {
              id: `local-assistant-${Date.now()}`,
              role: 'assistant',
              content: nextResult.answer,
              created_at: new Date().toISOString(),
              model_used: nextResult.model_used ?? null,
            },
          ]);
        }

        if (nextResult.sources && nextResult.sources.length > 0 && chatMode === ChatMode.DOCUMENT_ANALYSIS) {
          setExpandedSources(true);
          setActiveSourceIndex(1);
          setSplitViewOpen(true);
        }
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: preferredScrollBehavior() }), 100);
      }
    } catch {
      setError({ message: 'Sunucu baglanti hatasi. Backend calisiyor mu?' });
    } finally {
      stopResearchProgressFlow();
      setIsLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitQuery(query);
  }

  function handleStartEditUserMessage() {
    const targetQuery = lastSubmittedQuery.trim();
    if (!targetQuery || isLoading) return;
    setIsEditingUserMessage(true);
    setEditingUserQuery(targetQuery);
  }

  function handleCancelEditUserMessage() {
    setIsEditingUserMessage(false);
    setEditingUserQuery('');
  }

  function handleUpdateUserMessage() {
    const normalized = editingUserQuery.trim();
    if (isLoading || !normalized) return;
    void submitQuery(normalized);
  }

  function mapSourceType(source: Source): string {
    const raw = (source.source_type ?? source.quality_source_class ?? '').toLowerCase();
    if (raw === 'kanun' || raw === 'ictihat' || raw === 'user_document') {
      return raw;
    }
    return 'other';
  }

  function buildCitationSnapshot() {
    if (!result?.sources || result.sources.length === 0) return [];

    return result.sources.map((source, index) => ({
      source_id: source.id ?? source.doc_id ?? `source-${index + 1}`,
      source_type: mapSourceType(source),
      source_anchor: source.source_anchor,
      page_no: source.page_no,
      char_start: source.char_start,
      char_end: source.char_end,
      doc_version: source.version_type,
      citation_text: source.citation ?? source.title ?? `Kaynak ${index + 1}`,
      metadata: {
        source_origin: source.source_origin ?? 'unknown',
        authority_score: source.authority_score,
        final_score: source.final_score,
      },
    }));
  }

  function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  async function handleSaveAction(
    saveTarget: SaveTarget,
    clientAction: ClientAction = ClientAction.NONE,
    options?: { asVersion?: boolean },
  ) {
    if (!result) return;
    if (!featureFlags.save_targets_v2) {
      setSaveError('Kaydetme akisi su an feature flag ile kapali.');
      setSaveSuccess(null);
      return;
    }
    if (clientAction !== ClientAction.NONE && !featureFlags.client_translator_draft) {
      setSaveError('Muvekkile taslak olusturma su an kapali.');
      setSaveSuccess(null);
      return;
    }

    const normalizedCaseId = saveCaseId.trim() || queryCaseId.trim();
    if (saveTarget === SaveTarget.EXISTING_CASE && !normalizedCaseId) {
      setSaveError("Mevcut Case'e kaydetmek icin Case UUID girin.");
      setSaveSuccess(null);
      return;
    }
    if (saveTarget === SaveTarget.EXISTING_CASE && normalizedCaseId && !isUuid(normalizedCaseId)) {
      setSaveError('Case UUID formati gecersiz.');
      setSaveSuccess(null);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const payload: RagSaveRequestV3 = {
        answer: result.answer,
        response_type: result.response_type,
        title: lastSubmittedQuery.trim().slice(0, 140) || 'AI Work Product',
        output_type: 'analysis_note',
        output_kind: 'analysis_note',
        save_mode: SaveMode.OUTPUT_WITH_THREAD_AND_SOURCES,
        save_target: saveTarget,
        parent_output_id: options?.asVersion ? (lastSavedOutputId ?? undefined) : undefined,
        is_final: options?.asVersion ? false : undefined,
        thread_id: threadId ?? undefined,
        source_message_id: sourceUserMessageId ?? undefined,
        saved_from_message_id: sourceAssistantMessageId ?? undefined,
        case_id: saveTarget === SaveTarget.EXISTING_CASE ? normalizedCaseId : undefined,
        new_case_title:
          saveTarget === SaveTarget.NEW_CASE
            ? newCaseTitle.trim() || `Yeni Case ${new Date().toISOString().slice(0, 10)}`
            : undefined,
        citations: buildCitationSnapshot(),
        client_action: clientAction,
        client_draft_title:
          clientAction !== ClientAction.NONE
            ? clientDraftTitle.trim() || 'Muvekkil Bilgilendirme Taslagi'
            : undefined,
        metadata: {
          chat_mode: chatMode,
          ai_tier: featureFlags.tier_selector_ui ? selectedTier : AiTier.HAZIR_CEVAP,
          model_used: result.model_used,
          audit_trail_id: result.audit_trail_id,
          response_type: result.response_type,
        },
      };

      const response = await fetch('/api/rag/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        setSaveError(
          typeof data?.error === 'string'
            ? data.error
            : 'Kaydetme islemi basarisiz oldu.',
        );
        return;
      }

      const saveResult = data as RagSaveResponseV3;
      setLastSavedOutputId(saveResult.saved_output_id);
      void loadSavedOutputs();
      const summary = [
        `Kaydedildi: ${saveResult.saved_output_id.slice(0, 8)}`,
        saveResult.case_created ? 'yeni case olusturuldu' : saveResult.case_id ? 'case baglandi' : 'kisisel kayit',
        saveResult.client_message_id ? 'muvekkil taslagi hazirlandi' : null,
      ]
        .filter(Boolean)
        .join(' | ');
      setSaveSuccess(summary);
    } catch {
      setSaveError('Kaydetme servisine ulasilamadi.');
    } finally {
      setIsSaving(false);
    }
  }

  const effectiveSelectedTier = featureFlags.tier_selector_ui ? selectedTier : AiTier.HAZIR_CEVAP;
  const selectedTierMeta = TIER_OPTIONS.find((option) => option.value === effectiveSelectedTier) ?? TIER_OPTIONS[0];
  const tierValue = result ? result.tier_used ?? result.tier ?? selectedTierMeta.tier : selectedTierMeta.tier;
  const tier = TIER_LABELS[tierValue] ?? TIER_LABELS[1];
  const groundingPct = result ? Math.round(result.grounding_ratio * 100) : 0;
  const estimatedCost =
    result?.estimated_cost ?? result?.cost_estimate?.total_cost_usd ?? 0;
  const chatModeLabel = CHAT_MODE_LABELS[chatMode];
  const temporalFields: TemporalFields = result?.temporal_fields ?? {
    as_of_date: asOfDate || undefined,
    event_date: eventDate || undefined,
    decision_date: decisionDate || undefined,
  };
  const citationQuality = result?.citation_quality;
  const citationStrength = citationQuality?.source_strength;
  const citationDist = citationQuality?.source_type_distribution
    ? Object.entries(citationQuality.source_type_distribution)
        .filter(([, value]) => typeof value === 'number' && value > 0)
        .map(([key, value]) => `${SOURCE_CLASS_LABEL[key] ?? key}:${value}`)
        .join(', ')
    : '';
  const summaryText = result
    ? (result.answer_sentences?.slice(0, 2).map((sentence) => sentence.text).join(' ') || result.answer)
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  const normalizedLeftSearch = leftSearchTerm.trim().toLowerCase();
  const historyEntries = [
    threadId ? `Thread: ${threadId.slice(0, 8)}` : null,
    lastUserMessageId ? `Kullanici: ${lastUserMessageId.slice(0, 8)}` : null,
    sourceUserMessageId ? `KullaniciMesaj: ${sourceUserMessageId.slice(0, 8)}` : null,
    sourceAssistantMessageId ? `AsistanMesaj: ${sourceAssistantMessageId.slice(0, 8)}` : null,
    lastSubmittedQuery.trim() ? `Son sorgu: ${lastSubmittedQuery.trim().slice(0, 56)}` : null,
  ].filter((item): item is string => Boolean(item));
  const filteredTemplates = TEMPLATE_PROMPTS.filter((template) =>
    normalizedLeftSearch ? template.toLowerCase().includes(normalizedLeftSearch) : true,
  );
  const filteredDocuments = uploadedDocuments.filter((doc) =>
    normalizedLeftSearch ? doc.file_name.toLowerCase().includes(normalizedLeftSearch) : true,
  );
  const filteredSavedOutputs = savedOutputs.filter((item) => {
    const haystack = `${item.title ?? ''} ${item.content ?? ''}`.toLowerCase();
    return normalizedLeftSearch ? haystack.includes(normalizedLeftSearch) : true;
  });
  const uploadStageLabel = UPLOAD_STAGE_LABEL[uploadStage];
  const activeResearchIndex = researchStage ? RESEARCH_STAGE_ORDER.indexOf(researchStage) : -1;
  const researchProgressPct =
    activeResearchIndex >= 0
      ? Math.round(((activeResearchIndex + 1) / RESEARCH_STAGE_ORDER.length) * 100)
      : 0;
  const hasConversation = Boolean(lastSubmittedQuery || result || isLoading || error);
  const isUiBusy = isLoading || flagsLoading;
  const sidebarConversationItems = lastSubmittedQuery.trim()
    ? [
        `${lastSubmittedQuery.trim().slice(0, 30)}${lastSubmittedQuery.trim().length > 30 ? '…' : ''}`,
        'Sohbet 2',
        'Sohbet 3',
      ]
    : ['Sohbet 1', 'Sohbet 2', 'Sohbet 3'];
  const activeUploadIndex = UPLOAD_STAGE_ORDER.indexOf(uploadStage);
  const stepOneComposerPosition = hasConversation ? 'bottom-16 md:bottom-20' : 'top-[61%] md:top-[59%]';

  function openInspector(nextTab: InspectorTab) {
    setInspectorTab(nextTab);
    setInspectorOpen(true);
  }

  function openSourceFromCitation(sourceRef: number) {
    openInspector('sources');
    setExpandedSources(true);
    setSplitViewOpen(true);
    setActiveSourceIndex(sourceRef);
    setTimeout(() => {
      document
        .getElementById(`source-${sourceRef}`)
        ?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' });
    }, 80);
  }

  function resetConversation() {
    setQuery('');
    setLastSubmittedQuery('');
    setResult(null);
    setError(null);
    setHasSentFirstQuery(false);
    setThreadId(null);
    setSourceUserMessageId(null);
    setSourceAssistantMessageId(null);
    setThreadMessages([]);
    setLastUserMessageId(null);
    setLastAssistantMessageId(null);
    setCopyState(null);
    setAssistantFeedback(null);
    setEditingUserQuery('');
    setIsEditingUserMessage(false);
    setShowDislikeReasons(false);
    setSelectedDislikeReason(null);
    setFeedbackError(null);
    setIsEditingUserMessage(false);
    setSplitViewOpen(false);
    setActiveSourceIndex(null);
    setInspectorOpen(false);
  }

  function renderStepOneSidebar() {
    return (
      <>
        <div className="border-b border-slate-200 p-3">
          <Button
            type="button"
            onClick={resetConversation}
            className="h-9 w-full justify-start gap-2 bg-slate-900 text-xs text-white hover:bg-slate-700"
          >
            <Plus className="h-3.5 w-3.5" /> Yeni Sohbet
          </Button>
        </div>
        <div className="space-y-1 p-2">
          {sidebarConversationItems.map((item) => (
            <button
              key={item}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
            >
              <BookOpen className="h-3.5 w-3.5 text-slate-400" />
              <span className="truncate">{item}</span>
            </button>
          ))}
        </div>
        {!lastSubmittedQuery && <p className="px-3 pt-2 text-xs text-slate-500">Henuz sohbet yok.</p>}
      </>
    );
  }

  if (currentUiPhase === 1) {
    return (
      <div className="hukuk-chat-shell h-full w-full bg-[var(--bg)] text-[var(--text)]">
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.txt,.md,.rtf,.csv,.json,.xml,.html,.htm,.log"
          className="hidden"
          onChange={handleDocumentUpload}
        />

        <div className="hukuk-chat-frame h-full w-full overflow-hidden rounded-none">
          <div className="grid h-full min-h-0 md:grid-cols-[240px_1fr]">
            <aside className="hidden border-r border-slate-200 bg-white/95 md:block">{renderStepOneSidebar()}</aside>

            {leftPaneOpen && (
              <aside className="fixed inset-0 z-50 md:hidden">
                <button
                  type="button"
                  className="absolute inset-0 bg-slate-900/40"
                  aria-label="Sohbet panelini kapat"
                  onClick={() => setLeftPaneOpen(false)}
                />
                <div className="relative h-full w-[82%] max-w-[300px] border-r border-slate-200 bg-white">
                  <div className="flex h-12 items-center justify-between border-b border-slate-200 px-3">
                    <p className="text-sm font-semibold text-slate-800">Sohbetler</p>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLeftPaneOpen(false)}>
                      <X className="h-4 w-4 text-slate-600" />
                    </Button>
                  </div>
                  {renderStepOneSidebar()}
                </div>
              </aside>
            )}

            <main className="relative flex min-h-0 flex-col bg-white/80">
              <div className="absolute left-3 top-3 z-10 flex items-center gap-2 md:hidden">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 border-slate-200 bg-white"
                  onClick={() => setLeftPaneOpen(true)}
                >
                  <Menu className="h-4 w-4 text-slate-600" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-slate-200 bg-white px-3 text-xs"
                  onClick={resetConversation}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Yeni
                </Button>
              </div>

              <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                {showResearchProgress && (
                  <Badge variant="muted" className="border-blue-200 bg-blue-50 text-[11px] text-blue-700">
                    {researchStage ? RESEARCH_STAGE_LABEL[researchStage] : 'Arastirma'}
                  </Badge>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-slate-200 bg-white px-3 text-xs"
                  onClick={() => openInspector((result?.sources?.length ?? 0) > 0 ? 'sources' : 'research')}
                >
                  Inspector
                </Button>
              </div>

              <div
                className={cn(
                  'flex-1 overflow-y-auto overscroll-contain p-4 pt-14 md:p-8 md:pt-8',
                  hasConversation ? 'pb-60 md:pb-64' : 'pb-24 md:pb-28',
                )}
              >
                {!hasConversation ? (
                  <div className="flex h-full min-h-[360px] flex-col items-center justify-center pb-16 text-center md:pb-20">
                    <p className="min-h-[1.9rem] text-lg font-semibold text-blue-700">
                      {introHeadline}
                      {introHeadline.length < 'Bugun ne arastiriyoruz?'.length && (
                        <span className="hukuk-intro-caret ml-1 inline-block h-5 w-[2px] rounded-full bg-blue-600 align-[-2px]" />
                      )}
                    </p>

                    <div className="relative mb-4 mt-5">
                      <div className={cn('rounded-full border border-orange-200 bg-orange-50 p-3', showIntroGavelHit && 'hukuk-gavel-hit')}>
                        <Scale className="h-7 w-7 text-orange-500" />
                      </div>
                      {showIntroGavelHit && (
                        <span className="hukuk-impact-ping absolute -bottom-1 left-1/2 h-2 w-12 -translate-x-1/2 rounded-full bg-orange-300/80" />
                      )}
                    </div>
                    <p className="text-2xl font-semibold text-slate-800">Hukuki sorunu yaz, birlikte inceleyelim.</p>
                    <p className="mt-2 max-w-md text-sm text-slate-500">Sohbet odakli calis: sor, netlestir, devam et.</p>
                  </div>
                ) : (
                  <div className="mx-auto w-full max-w-[820px] space-y-4">
                    {threadMessages.map((message) => {
                      if (message.role === 'user') {
                        const isLastUserMsg = message.id === lastUserMessageId;
                        if (isLastUserMsg && isEditingUserMessage) {
                          return (
                            <div key={message.id} className="space-y-2">
                              <div className="flex justify-end">
                                <div className="hukuk-message-pop w-full max-w-[85%] rounded-2xl bg-slate-200 px-3 py-2 text-slate-800">
                                  <textarea
                                    ref={inlineEditTextareaRef}
                                    value={editingUserQuery}
                                    onChange={(e) => setEditingUserQuery(e.target.value)}
                                    rows={3}
                                    className="w-full resize-none bg-transparent text-sm text-slate-800 placeholder:text-slate-500 focus:outline-none"
                                    placeholder="Sorunuzu duzenleyin"
                                    disabled={isLoading}
                                  />
                                </div>
                              </div>
                              <div className="flex justify-end">
                                <div className="flex items-center gap-1">
                                  <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={handleCancelEditUserMessage} disabled={isLoading}>Iptal</Button>
                                  <Button type="button" size="sm" className="h-8 text-xs" onClick={handleUpdateUserMessage} disabled={isUiBusy || !editingUserQuery.trim()}>Guncelle</Button>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div key={message.id} className="space-y-2">
                            <div className="flex justify-end">
                              <div className="hukuk-message-pop max-w-[85%] rounded-2xl bg-slate-200 px-4 py-2.5 text-sm text-slate-800">
                                <p className="whitespace-pre-wrap">{message.content}</p>
                              </div>
                            </div>
                            {isLastUserMsg && !isEditingUserMessage && (
                              <div className="flex justify-end">
                                <div className="flex items-center gap-1">
                                  <button type="button" className={cn('hukuk-icon-action', copyState === 'user' && 'text-emerald-600')} onClick={() => void copyMessageContent('user', message.content)} aria-label="Mesaji kopyala" title="Kopyala">
                                    {copyState === 'user' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                  </button>
                                  <button type="button" className="hukuk-icon-action disabled:opacity-60" onClick={handleStartEditUserMessage} disabled={isLoading || !lastSubmittedQuery.trim()} aria-label="Mesaji duzenle" title="Duzenle">
                                    <PenLine className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      }

                      if (message.role === 'assistant') {
                        const isLastAssistantMsg = message.id === lastAssistantMessageId;
                        // Render rich content for the last message if `result` is available
                        if (isLastAssistantMsg && result) {
                          return (
                            <div key={message.id} className="space-y-2">
                              <div className="flex justify-start">
                                <div className="hukuk-message-pop max-w-[90%] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed shadow-sm">
                                  {result.answer_sentences && result.answer_sentences.length > 0 ? (
                                    <p className="space-y-0.5 leading-relaxed">
                                      {result.answer_sentences.map((sentence) => (
                                        <span key={sentence.sentence_id}>
                                          <span className={cn(sentence.is_grounded ? 'text-slate-800' : 'italic text-orange-600')}>{sentence.text}</span>
                                          {sentence.source_refs.map((ref) => (
                                            <button key={ref} type="button" onClick={() => openSourceFromCitation(ref)} className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-600 hover:bg-slate-200 hover:text-slate-800">
                                              <sup>({ref})</sup>
                                            </button>
                                          ))}{' '}
                                        </span>
                                      ))}
                                    </p>
                                  ) : (
                                    <p className="whitespace-pre-wrap">{summaryText || result.answer}</p>
                                  )}
                                  {(result.sources ?? []).length > 0 && (
                                    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
                                      <span className="text-[11px] text-slate-500">Kaynak:</span>
                                      {(result.sources ?? []).map((_, index) => (
                                        <button key={`inline-citation-${index + 1}`} type="button" onClick={() => openSourceFromCitation(index + 1)} className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200">
                                          ({index + 1})
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex justify-start pl-1">
                                <div className="max-w-[90%] space-y-2">
                                  <div className="flex flex-wrap items-center gap-1">
                                    <button type="button" className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300 hover:text-slate-800" onClick={() => void copyMessageContent('assistant', result.answer)}>
                                      <Copy className="mr-1 inline h-3 w-3" />
                                      {copyState === 'assistant' ? 'Kopyalandı' : ''}
                                    </button>
                                    <button type="button" className={cn('rounded-full border px-2.5 py-1 text-[11px] disabled:opacity-60', assistantFeedback === 'like' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700')} disabled={feedbackPending || !lastAssistantMessageId} onClick={() => void submitAssistantFeedback('like')}>
                                      <ThumbsUp className="mr-1 inline h-3 w-3" />
                            
                                    </button>
                                    <button type="button" className={cn('rounded-full border px-2.5 py-1 text-[11px] disabled:opacity-60', assistantFeedback === 'dislike' ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600 hover:border-red-300 hover:text-red-700')} disabled={feedbackPending || !lastAssistantMessageId} onClick={() => setShowDislikeReasons((value) => !value)}>
                                      <ThumbsDown className="mr-1 inline h-3 w-3" />
                                      
                                    </button>
                                  </div>
                                  {showDislikeReasons && (
                                    <div className="rounded-xl border border-red-100 bg-red-50/70 p-2">
                                      <p className="mb-2 text-[11px] font-medium text-red-700">Neden?</p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {DISLIKE_REASON_OPTIONS.map((option) => (
                                          <button key={option.value} type="button" className={cn('rounded-full border px-2.5 py-1 text-[11px]', selectedDislikeReason === option.value ? 'border-red-300 bg-red-100 text-red-700' : 'border-red-200 bg-white text-red-600 hover:bg-red-100')} disabled={feedbackPending || !lastAssistantMessageId} onClick={() => void submitAssistantFeedback('dislike', option.value)}>
                                            {option.label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {feedbackError && <p className="text-[11px] text-red-600">{feedbackError}</p>}
                                </div>
                              </div>
                              <div className="flex justify-start pl-1">
                                <p className="max-w-[90%] text-xs text-slate-500">
                                  {result.legal_disclaimer?.disclaimer_text || 'Nihai hukuki gorus yerine gecmez. Kritik adimlardan once birincil kaynak dogrulamasi yapin.'}
                                </p>
                              </div>
                            </div>
                          );
                        }
                        // Render simple bubble for older assistant messages
                        return (
                          <div key={message.id} className="flex justify-start">
                            <div className="hukuk-message-pop max-w-[85%] rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm">
                              <p className="whitespace-pre-wrap">{message.content}</p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })}

                    {isLoading && (
                      <div className="flex justify-start">
                        <div className="hukuk-message-pop inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
                          <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                          Yanit hazirlaniyor...
                        </div>
                      </div>
                    )}

                    {error && !isLoading && (
                      <div className="flex justify-start">
                        <div className="hukuk-message-pop max-w-[85%] rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
                          {error.message}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <form
                onSubmit={handleSubmit}
                className={cn('pointer-events-none absolute inset-x-0 px-4 md:px-8', stepOneComposerPosition)}
              >
                <div className="hukuk-floating-composer pointer-events-auto mx-auto w-full max-w-[980px] rounded-[28px] p-3">
                  <div className="relative mb-2">
                    <textarea
                      ref={composerTextareaRef}
                      placeholder="Sorunuzu yazın"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      rows={3}
                      className="hukuk-composer-textarea w-full resize-none rounded-[22px] border-0 bg-transparent px-3 py-2 pr-10 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                      disabled={isUiBusy}
                    />
                    {isComposerScrollable && (
                      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => scrollComposerContent('up')}
                          className="rounded border border-slate-200 bg-white p-1 text-slate-500 hover:text-slate-700"
                          aria-label="Yukari kaydir"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => scrollComposerContent('down')}
                          className="rounded border border-slate-200 bg-white p-1 text-slate-500 hover:text-slate-700"
                          aria-label="Asagi kaydir"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 px-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="hukuk-plain-action h-8 w-8 p-0 text-xs"
                      onClick={() => {
                        uploadInputRef.current?.click();
                      }}
                      disabled={isUiBusy || isUploading}
                      title="Belge ekle"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                    </Button>
                    <div ref={modeMenuRef} className="relative">
                      <button
                        type="button"
                        disabled={isUiBusy}
                        onClick={() => setIsModeMenuOpen((value) => !value)}
                        className="hukuk-mode-flat flex h-8 min-w-[104px] max-w-[140px] items-center justify-between gap-1.5 rounded-lg px-2 text-[11px]"
                        aria-haspopup="menu"
                        aria-expanded={isModeMenuOpen}
                      >
                        <span className="truncate">{selectedTierMeta.label}</span>
                        <ChevronDown className={cn('h-3 w-3 transition-transform', isModeMenuOpen && 'rotate-180')} />
                      </button>

                      {isModeMenuOpen && (
                        <div className="absolute bottom-[calc(100%+0.45rem)] right-0 z-[90] w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_22px_35px_-24px_rgba(15,23,42,0.45)] md:bottom-auto md:right-auto md:left-[calc(100%+0.45rem)] md:top-1/2 md:-translate-y-1/2">
                          {TIER_OPTIONS.map((option) => {
                            const isActive = option.value === effectiveSelectedTier;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                role="menuitem"
                                disabled={isUiBusy}
                                onClick={() => {
                                  setSelectedTier(option.value);
                                  setIsModeMenuOpen(false);
                                }}
                                className={cn(
                                  'flex w-full flex-col px-3 py-2 text-left text-xs transition-colors',
                                  isActive
                                    ? 'bg-slate-100 text-slate-900'
                                    : 'text-slate-700 hover:bg-slate-50',
                                )}
                              >
                                <span className="font-semibold leading-tight">{option.label}</span>
                                <span className="mt-0.5 text-[10px] leading-tight opacity-80">{option.description}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <Button
                      type="submit"
                      disabled={isUiBusy || !query.trim()}
                      className={cn(
                        'ml-auto h-8 w-8 rounded-full bg-white p-0 text-slate-900 shadow-md hover:bg-slate-100',
                        sendButtonAnimation > 0 && 'is-strike',
                      )}
                      aria-label="Mesaji gonder"
                      title="Gonder"
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send
                          key={`send-icon-${sendButtonAnimation}`}
                          className={cn('h-5 w-5', sendButtonAnimation > 0 && 'hukuk-send-animation')}
                        />
                      )}
                    </Button>                    
                  </div>

                </div>
              </form>
            </main>

            {inspectorOpen && (
              <aside className="fixed inset-0 z-[70]">
                <button
                  type="button"
                  className="absolute inset-0 bg-slate-900/35"
                  aria-label="Inspector kapat"
                  onClick={() => setInspectorOpen(false)}
                />
                <div className="hukuk-inspector-panel absolute right-0 top-0 h-full w-full max-w-[420px] overflow-y-auto p-3">
                  <div className="mb-3 grid grid-cols-3 gap-2">
                    <Button type="button" size="sm" variant={inspectorTab === 'sources' ? 'default' : 'outline'} className="text-xs" onClick={() => setInspectorTab('sources')}>
                      Kaynaklar
                    </Button>
                    <Button type="button" size="sm" variant={inspectorTab === 'documents' ? 'default' : 'outline'} className="text-xs" onClick={() => setInspectorTab('documents')}>
                      Belgeler
                    </Button>
                    <Button type="button" size="sm" variant={inspectorTab === 'research' ? 'default' : 'outline'} className="text-xs" onClick={() => setInspectorTab('research')}>
                      Arastirma
                    </Button>
                  </div>

                  {inspectorTab === 'sources' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kaynak Listesi</p>
                        <Badge variant="muted" className="text-xs">
                          {(result?.sources ?? []).length}
                        </Badge>
                      </div>

                      {(result?.sources ?? []).length === 0 && <p className="text-xs text-slate-500">Henuz kaynak yok.</p>}

                      {(result?.sources ?? []).map((src, idx) => (
                        <div
                          id={`source-${idx + 1}`}
                          key={src.id ?? src.doc_id ?? `source-${idx + 1}`}
                          className={cn(
                            'rounded-md border border-slate-200 p-2 text-xs text-slate-700',
                            activeSourceIndex === idx + 1 && splitViewOpen && 'border-blue-300 bg-blue-50/50',
                          )}
                        >
                          <div className="mb-1 flex items-start justify-between gap-2">
                            <p className="font-semibold">[{idx + 1}] {src.title ?? src.citation ?? `Kaynak ${idx + 1}`}</p>
                            <Badge variant="muted" className="text-[11px]">
                              {SOURCE_CLASS_LABEL[src.quality_source_class ?? ''] ?? src.source_type ?? 'Kaynak'}
                            </Badge>
                          </div>
                          <p className="line-clamp-3 text-slate-600">{src.content}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px]"
                              onClick={() => {
                                setActiveSourceIndex(idx + 1);
                                setSplitViewOpen(true);
                              }}
                            >
                              Snippeti ac
                            </Button>
                          </div>
                        </div>
                      ))}

                      <SourceSplitViewer
                        sources={result?.sources ?? []}
                        selectedIndex={activeSourceIndex}
                        isOpen={splitViewOpen}
                        onSelect={(index) => setActiveSourceIndex(index)}
                        onClose={() => setSplitViewOpen(false)}
                      />
                    </div>
                  )}

                  {inspectorTab === 'documents' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Belge Akisi</p>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            disabled={isLoading || isUploading}
                            onClick={() => uploadInputRef.current?.click()}
                          >
                            <Upload className="mr-1 h-3.5 w-3.5" /> Belge Yukle
                          </Button>
                          {isUploading && (
                            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={handleCancelUpload}>
                              Durdur
                            </Button>
                          )}
                        </div>
                      </div>

                      {showUploadProgress && (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                          <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600">
                            <span>Durum: {uploadStageLabel}</span>
                            <span>%{uploadProgressPct}</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${uploadProgressPct}%` }} />
                          </div>
                        </div>
                      )}

                      <div className="rounded-md border border-slate-200 bg-white p-2 text-[11px] text-slate-600">
                        <p className="mb-1 font-medium text-slate-700">Yukleme adimlari</p>
                        <div className="grid gap-1">
                          {UPLOAD_STAGE_ORDER.map((stage, index) => (
                            <div key={stage} className="flex items-center justify-between">
                              <span>{UPLOAD_STAGE_LABEL[stage]}</span>
                              <span
                                className={cn(
                                  'text-[10px]',
                                  uploadStage === stage
                                    ? 'text-blue-700'
                                    : index < activeUploadIndex
                                      ? 'text-emerald-700'
                                      : 'text-slate-400',
                                )}
                              >
                                {uploadStage === stage ? 'Aktif' : index < activeUploadIndex ? 'Tamamlandi' : 'Bekliyor'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {isUploading && <p className="text-xs text-blue-700">Belge yukleme adimi calisiyor.</p>}
                      {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}

                      {uploadedDocuments.length === 0 ? (
                        <p className="text-xs text-slate-500">Yuklu belge bulunmuyor.</p>
                      ) : (
                        uploadedDocuments.map((doc) => (
                          <div key={doc.doc_id} className="rounded-md border border-slate-200 p-2 text-xs">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={doc.selected}
                                onChange={() =>
                                  setUploadedDocuments((prev) =>
                                    prev.map((item) =>
                                      item.doc_id === doc.doc_id ? { ...item, selected: !item.selected } : item,
                                    ),
                                  )
                                }
                                className="h-3.5 w-3.5"
                              />
                              <span className="flex-1 truncate text-slate-700">{doc.file_name}</span>
                              <button
                                type="button"
                                onClick={() => setUploadedDocuments((prev) => prev.filter((item) => item.doc_id !== doc.doc_id))}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                aria-label="Belgeyi kaldir"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {inspectorTab === 'research' && (
                    <div className="space-y-2 text-xs text-slate-600">
                      <p className="font-semibold uppercase tracking-wide text-slate-500">Arastirma Durumu</p>
                      <div className="rounded-md border border-slate-200 p-2">Kapsam: {chatModeLabel} | Mod: {selectedTierMeta.label}</div>
                      <div className="rounded-md border border-blue-100 bg-blue-50/60 p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-medium text-blue-900">Anlik durum</span>
                          <span className="text-[11px] text-blue-700">%{researchProgressPct}</span>
                        </div>
                        <p className="text-[11px] text-blue-800">{researchStage ? RESEARCH_STAGE_LABEL[researchStage] : 'Hazirlaniyor'}</p>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${researchProgressPct}%` }} />
                        </div>
                      </div>
                      <div className="rounded-md border border-slate-200 p-2">
                        <p className="mb-2 font-medium text-slate-700">Adimlar</p>
                        <div className="space-y-1">
                          {RESEARCH_STAGE_ORDER.map((stage, index) => {
                            const status =
                              index < activeResearchIndex ? 'Tamamlandi' : index === activeResearchIndex ? 'Aktif' : 'Bekliyor';
                            return (
                              <div key={stage} className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1">
                                <span>{RESEARCH_STAGE_LABEL[stage]}</span>
                                <span className="text-[11px] text-slate-500">{status}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800">
                        Nihai hukuki gorus yerine gecmez. Kritik kararlar oncesi birincil kaynak dogrulamasi yapin.
                      </div>
                    </div>
                  )}
                </div>
              </aside>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="hukuk-neo flex min-h-[calc(100vh-12rem)] flex-col space-y-4">
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.txt,.md,.rtf,.csv,.json,.xml,.html,.htm,.log"
        className="hidden"
        onChange={handleDocumentUpload}
      />

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        {leftPaneOpen && (
          <aside className="hukuk-panel hidden rounded-xl border p-3 xl:block">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={leftPaneTab === 'files' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLeftPaneTab('files')}
              className="text-xs"
            >
              Dosyalar
            </Button>
            <Button
              type="button"
              variant={leftPaneTab === 'history' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLeftPaneTab('history')}
              className="text-xs"
            >
              Gecmis
            </Button>
            <Button
              type="button"
              variant={leftPaneTab === 'search' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLeftPaneTab('search')}
              className="text-xs"
            >
              Arama
            </Button>
            <Button
              type="button"
              variant={leftPaneTab === 'templates' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLeftPaneTab('templates')}
              className="text-xs"
            >
              Sablonlar
            </Button>
          </div>

          <Input
            value={leftSearchTerm}
            onChange={(event) => setLeftSearchTerm(event.target.value)}
            placeholder="Dosya veya sablon ara"
            className="mb-3 h-8 text-xs"
          />

          {leftPaneTab === 'files' && (
            <div className="space-y-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                Matter: {queryCaseId.trim() || 'Genel Calisma Alani'}
              </div>
              {filteredDocuments.length === 0 ? (
                <p className="text-xs text-slate-500">Belge bulunamadi.</p>
              ) : (
                filteredDocuments.map((doc) => (
                  <div key={doc.doc_id} className="rounded-md border border-slate-200 p-2 text-xs text-slate-700">
                    <p className="truncate font-medium">{doc.file_name}</p>
                    <p className="mt-1 text-[11px] text-slate-500">ID: {doc.doc_id.slice(0, 8)}</p>
                  </div>
                ))
              )}
              <div className="border-t border-slate-200 pt-2">
                <p className="mb-2 text-[11px] font-medium text-slate-600">Kaydedilen Ciktilar</p>
                {filteredSavedOutputs.length === 0 ? (
                  <p className="text-xs text-slate-500">Kayitli cikti bulunamadi.</p>
                ) : (
                  <div className="space-y-2">
                    {filteredSavedOutputs.slice(0, 12).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="w-full rounded-md border border-slate-200 p-2 text-left text-xs hover:border-blue-200 hover:bg-blue-50"
                        onClick={() => {
                          const text = (item.content ?? '').trim();
                          if (!text) return;
                          setQuery(text.slice(0, 4000));
                          setLastSavedOutputId(item.id);
                        }}
                      >
                        <p className="truncate font-medium text-slate-700">{item.title ?? 'Kayitli Cikti'}</p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          v{item.version_no ?? 1} · {(item.id ?? '').slice(0, 8)}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="border-t border-slate-200 pt-2">
                <p className="mb-2 text-[11px] font-medium text-slate-600">Muvekkil Taslaklari</p>
                {clientDrafts.length === 0 ? (
                  <p className="text-xs text-slate-500">Taslak bulunamadi.</p>
                ) : (
                  <div className="space-y-2">
                    {clientDrafts.slice(0, 8).map((draft) => (
                      <a
                        key={draft.id}
                        href="/dashboard/clients"
                        className="block rounded-md border border-slate-200 p-2 text-xs hover:border-blue-200 hover:bg-blue-50"
                      >
                        <p className="truncate font-medium text-slate-700">{draft.title ?? 'Muvekkil Taslagi'}</p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {draft.status} · {(draft.id ?? '').slice(0, 8)}
                        </p>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {leftPaneTab === 'history' && (
            <div className="space-y-2">
              {threadMessages.length === 0 && historyEntries.length === 0 ? (
                <p className="text-xs text-slate-500">Heniz gecmis kaydi yok.</p>
              ) : (
                <>
                  {historyEntries.map((item) => (
                    <div key={item} className="rounded-md border border-slate-200 p-2 text-xs text-slate-700">
                      {item}
                    </div>
                  ))}
                  {threadMessages.slice(-20).map((message) => (
                    <div key={message.id} className="rounded-md border border-slate-200 p-2 text-xs text-slate-700">
                      <p className="mb-1 font-medium text-slate-600">
                        {message.role === 'assistant' ? 'Asistan' : 'Kullanici'} · {(message.id ?? '').slice(0, 8)}
                      </p>
                      <p className="line-clamp-4 whitespace-pre-wrap">{message.content}</p>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {leftPaneTab === 'search' && (
            <div className="space-y-2 text-xs text-slate-600">
              <p className="font-medium text-slate-700">Arama Sonuclari</p>
              {filteredTemplates.slice(0, 3).map((template) => (
                <div key={template} className="rounded-md border border-slate-200 p-2">
                  {template}
                </div>
              ))}
              {filteredDocuments.slice(0, 3).map((doc) => (
                <div key={doc.doc_id} className="rounded-md border border-slate-200 p-2">
                  {doc.file_name}
                </div>
              ))}
            </div>
          )}

          {leftPaneTab === 'templates' && (
            <div className="space-y-2">
              {filteredTemplates.map((template) => (
                <button
                  key={template}
                  type="button"
                  onClick={() => setQuery(template)}
                  className="w-full rounded-md border border-slate-200 p-2 text-left text-xs text-slate-700 hover:border-blue-200 hover:bg-blue-50"
                >
                  {template}
                </button>
              ))}
            </div>
          )}
          </aside>
        )}

        <section className="flex min-h-0 flex-col space-y-4">
          <div className="mx-auto flex w-full max-w-[860px] items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Hukuk-AI</h2>
              <p className="text-xs text-slate-500">Odakli arastirma ve kaynakli cevaplar</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={queryCaseId}
                onChange={(event) => setQueryCaseId(event.target.value)}
                placeholder="Case UUID (opsiyonel)"
                className="hidden h-8 w-56 text-xs xl:block"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="hidden xl:inline-flex"
                onClick={() => setLeftPaneOpen((value) => !value)}
              >
                {leftPaneOpen ? 'Paneli Kapat' : 'Paneli Ac'}
              </Button>
              {!inspectorOpen && (result?.sources?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => openInspector('sources')}
                  className="hukuk-chip rounded-full px-3 py-1 text-xs font-medium"
                >
                  Kaynaklar ({result?.sources.length ?? 0})
                </button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => setInspectorOpen((value) => !value)}>
                {inspectorOpen ? 'Kaynak Panelini Kapat' : 'Kaynak Panelini Ac'}
              </Button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[860px] flex-1 space-y-4 overflow-y-auto pb-6">
            {featureFlags.memory_dashboard_v1 && <AssistantMemoryPanel />}

            {!hasConversation && (
              <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-6 text-center">
                <p className="text-sm font-semibold text-slate-900">Hukuk-AI ile calismaya baslayin</p>
                <p className="mt-1 text-xs text-slate-500">
                  Sorunuzu yazin; sistem adim adim arastirip kaynaklari sag panelde gostersin.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {TEMPLATE_PROMPTS.slice(0, 3).map((template) => (
                    <button
                      key={template}
                      type="button"
                      onClick={() => setQuery(template)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-blue-200 hover:text-blue-700"
                    >
                      {template.slice(0, 56)}{template.length > 56 ? '…' : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {hasConversation && (
              <>
            {threadMessages.length > 0 && (
              <div className="space-y-2">
                {threadMessages.slice(-8).map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      'max-w-[82%] rounded-2xl px-4 py-2 text-sm shadow-sm',
                      message.role === 'assistant'
                        ? 'border border-slate-200 bg-white text-slate-800'
                        : 'ml-auto bg-slate-200 text-slate-800',
                    )}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                ))}
              </div>
            )}
            {lastSubmittedQuery && (
              <div className="space-y-2">
                <div className="flex justify-end">
                  {isEditingUserMessage ? (
                    <div className="w-full max-w-[80%] rounded-2xl bg-slate-200 px-3 py-2 text-sm text-slate-800 shadow-sm">
                      <textarea
                        ref={inlineEditTextareaRef}
                        value={editingUserQuery}
                        onChange={(e) => setEditingUserQuery(e.target.value)}
                        rows={3}
                        className="w-full resize-none bg-transparent text-sm text-slate-800 placeholder:text-slate-500 focus:outline-none"
                        placeholder="Sorunuzu duzenleyin"
                        disabled={isLoading}
                      />
                    </div>
                  ) : (
                    <div className="max-w-[80%] rounded-2xl bg-slate-200 px-4 py-2 text-sm text-slate-800 shadow-sm">
                      {lastSubmittedQuery}
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <div className="flex items-center gap-1">
                    {isEditingUserMessage ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={handleCancelEditUserMessage}
                          disabled={isLoading}
                        >
                          Iptal
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={handleUpdateUserMessage}
                          disabled={isUiBusy || !editingUserQuery.trim()}
                        >
                          Guncelle
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={cn(
                            'hukuk-icon-action',
                            copyState === 'user' && 'text-emerald-600',
                          )}
                          onClick={() => void copyMessageContent('user', lastSubmittedQuery)}
                          aria-label="Mesaji kopyala"
                          title="Kopyala"
                        >
                          {copyState === 'user' ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          className="hukuk-icon-action disabled:opacity-60"
                          onClick={handleStartEditUserMessage}
                          disabled={isLoading || !lastSubmittedQuery.trim()}
                          aria-label="Mesaji duzenle"
                          title="Duzenle"
                        >
                          <PenLine className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {showResearchProgress && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-800">Sistem durumu: {researchStage ? RESEARCH_STAGE_LABEL[researchStage] : 'Hazirlaniyor'}</p>
                  <Badge variant="muted" className="text-xs">
                    %{researchProgressPct}
                  </Badge>
                </div>
                <div className="hukuk-progress-scan h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${researchProgressPct}%` }} />
                </div>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {RESEARCH_STAGE_ORDER.map((stage, index) => {
                    const status =
                      index < activeResearchIndex
                        ? 'tamamlandi'
                        : index === activeResearchIndex
                          ? 'aktif'
                          : 'bekliyor';
                    return (
                      <div key={stage} className="flex items-center gap-2 text-[11px] text-slate-600">
                        <span
                          className={cn(
                            'hukuk-step-dot',
                            status === 'tamamlandi' && 'is-done',
                            status === 'aktif' && 'is-active',
                          )}
                          aria-hidden="true"
                        >
                          {status === 'tamamlandi' ? '✓' : status === 'aktif' ? '•' : '○'}
                        </span>
                        <span>{RESEARCH_STAGE_LABEL[stage]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <p>{error.message}</p>
                  {error.code === 'NO_SOURCE_HARD_FAIL' && (
                    <p className="text-xs text-red-600">Kaynak bulunamadigi icin hukuki cevap uretilmedi (HTTP 422).</p>
                  )}
                </div>
              </div>
            )}

            {result && (
              <div ref={resultRef} className="hukuk-response-stamp">
                <Card className="hukuk-panel">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <BrainCircuit className="h-4 w-4 text-blue-600" />
                    AI Response Card
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <section className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ozet</p>
                    <p className="leading-relaxed text-slate-800">{summaryText || result.answer}</p>
                  </section>

                  <details className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Detay / Gerekce
                    </summary>
                    <div className="mt-3 space-y-2 text-sm text-slate-700">
                      {result.answer_sentences && result.answer_sentences.length > 0 ? (
                        <p className="space-y-0.5 leading-relaxed">
                          {result.answer_sentences.map((sentence) => (
                            <span key={sentence.sentence_id}>
                              <span className={cn(sentence.is_grounded ? 'text-slate-800' : 'italic text-orange-600')}>
                                {sentence.text}
                              </span>
                              {sentence.source_refs.map((ref) => (
                                <button
                                  key={ref}
                                  type="button"
                                  onClick={() => openSourceFromCitation(ref)}                                  
                                  className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-600 hover:bg-slate-200 hover:text-slate-800"
                                >
                                  <sup>[{ref}]</sup>
                                </button>
                              ))}{' '}
                            </span>
                          ))}
                        </p>
                      ) : (
                        <p className="whitespace-pre-wrap leading-relaxed text-slate-800">{result.answer}</p>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Badge variant="muted" className={cn('text-xs', tier.color)}>
                          Mod: {tier.label}
                        </Badge>
                        <Badge variant="muted" className="text-xs">
                          {chatModeLabel}
                        </Badge>
                        <Badge variant="muted" className="text-xs">
                          Dogrulama: %{groundingPct}
                        </Badge>
                        {citationStrength && (
                          <Badge variant="muted" className={cn('text-xs', CITATION_STRENGTH_COLOR[citationStrength] ?? '')}>
                            Kaynak gucu: {citationStrength}
                          </Badge>
                        )}
                        {estimatedCost !== undefined && (
                          <Badge variant="muted" className="text-xs">
                            Maliyet: {result.cost_estimate?.cached ? '$0.0000 (cache)' : `~$${estimatedCost.toFixed(4)}`}
                          </Badge>
                        )}
                        {citationDist && (
                          <Badge variant="muted" className="text-xs">
                            Kaynak dagilimi: {citationDist}
                          </Badge>
                        )}
                        {temporalFields.as_of_date && (
                          <Badge variant="muted" className="text-xs">
                            Analiz tarihi: {temporalFields.as_of_date}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </details>

                  <section className="hukuk-warning-callout rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="text-xs font-semibold uppercase tracking-wide">Riskler / Dikkat</p>
                    <p className="mt-1">
                      {result.legal_disclaimer?.disclaimer_text ||
                        'Nihai hukuki gorus yerine gecmez. Kritik bilgiler resmi kaynaklarla dogrulanmalidir.'}
                    </p>
                  </section>

                  <section className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kaynaklar</p>
                    <div className="flex flex-wrap gap-2">
                      {(result.sources ?? []).length === 0 && (
                        <span className="text-xs text-slate-500">Bu cevap icin kaynak kaydi bulunamadi.</span>
                      )}
                      {(result.sources ?? []).map((_, index) => (
                        <button
                          key={`chip-${index + 1}`}
                          type="button"
                          onClick={() => openSourceFromCitation(index + 1)}
                          className="hukuk-chip rounded-full px-2.5 py-1 text-xs hover:border-slate-300 hover:bg-slate-100"
                        >
                          ({index + 1})
                        </button>
                      ))}
                    </div>
                  </section>
                </CardContent>
                </Card>

                <div className="mt-2 flex flex-col gap-2 pl-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300 hover:text-slate-800"
                      onClick={() => void copyMessageContent('assistant', result.answer)}
                    >
                      <Copy className="mr-1 inline h-3 w-3" />
                      {copyState === 'assistant' ? 'Kopyalandi' : 'Kopyala'}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[11px] disabled:opacity-60',
                        assistantFeedback === 'like'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700',
                      )}
                      disabled={feedbackPending || !lastAssistantMessageId}
                      onClick={() => void submitAssistantFeedback('like')}
                    >
                      <ThumbsUp className="mr-1 inline h-3 w-3" />
                      Begendim
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[11px] disabled:opacity-60',
                        assistantFeedback === 'dislike'
                          ? 'border-red-300 bg-red-50 text-red-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-red-300 hover:text-red-700',
                      )}
                      disabled={feedbackPending || !lastAssistantMessageId}
                      onClick={() => setShowDislikeReasons((value) => !value)}
                    >
                      <ThumbsDown className="mr-1 inline h-3 w-3" />
                      Begenmedim
                    </button>
                  </div>

                  {showDislikeReasons && (
                    <div className="w-fit rounded-xl border border-red-100 bg-red-50/70 p-2">
                      <p className="mb-2 text-[11px] font-medium text-red-700">Neden?</p>
                      <div className="flex flex-wrap gap-1.5">
                        {DISLIKE_REASON_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={cn(
                              'rounded-full border px-2.5 py-1 text-[11px]',
                              selectedDislikeReason === option.value
                                ? 'border-red-300 bg-red-100 text-red-700'
                                : 'border-red-200 bg-white text-red-600 hover:bg-red-100',
                            )}
                            disabled={feedbackPending || !lastAssistantMessageId}
                            onClick={() => void submitAssistantFeedback('dislike', option.value)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {feedbackError && <p className="text-[11px] text-red-600">{feedbackError}</p>}
                </div>
              </div>
            )}

            {result && featureFlags.save_targets_v2 && (
              <details className="rounded-lg border border-slate-200 bg-white">
                <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-slate-600">
                  Kaydetme ve is akisina baglama secenekleri
                </summary>
                <Card className="border-0 shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Kaydet ve Is Akisina Bagla</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      placeholder="Mevcut Case UUID (opsiyonel)"
                      value={saveCaseId}
                      onChange={(e) => setSaveCaseId(e.target.value)}
                      disabled={isSaving}
                      className="text-xs"
                    />
                    <Input
                      placeholder="Yeni Case Basligi (opsiyonel)"
                      value={newCaseTitle}
                      onChange={(e) => setNewCaseTitle(e.target.value)}
                      disabled={isSaving}
                      className="text-xs"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSaving}
                      onClick={() => handleSaveAction(SaveTarget.MY_FILES)}
                    >
                      Dosyalarima Kaydet
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSaving}
                      onClick={() => handleSaveAction(SaveTarget.EXISTING_CASE)}
                    >
                      Mevcut Case'e Ekle
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSaving}
                      onClick={() => handleSaveAction(SaveTarget.NEW_CASE)}
                    >
                      Yeni Case Olustur
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSaving || !lastSavedOutputId}
                      onClick={() =>
                        handleSaveAction(
                          saveCaseId.trim()
                            ? SaveTarget.EXISTING_CASE
                            : newCaseTitle.trim()
                              ? SaveTarget.NEW_CASE
                              : SaveTarget.MY_FILES,
                          ClientAction.NONE,
                          { asVersion: true },
                        )
                      }
                    >
                      Ayni Metni Gelistir (Yeni Versiyon)
                    </Button>
                    {featureFlags.client_translator_draft && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isSaving}
                        onClick={() =>
                          handleSaveAction(
                            saveCaseId.trim()
                              ? SaveTarget.EXISTING_CASE
                              : newCaseTitle.trim()
                                ? SaveTarget.NEW_CASE
                                : SaveTarget.MY_FILES,
                            ClientAction.TRANSLATE_FOR_CLIENT_DRAFT,
                          )
                        }
                      >
                        Muvekkile Anlat
                      </Button>
                    )}
                  </div>
                  {saveError && <p className="text-xs text-red-600">{saveError}</p>}
                  {saveSuccess && <p className="text-xs text-green-700">{saveSuccess}</p>}
                </CardContent>
                </Card>
              </details>
            )}
              </>
            )}
          </div>
        </section>

        {inspectorOpen && (
          <aside className="fixed inset-0 z-50">
            <button
              type="button"
              aria-label="Inspector kapat"
              onClick={() => setInspectorOpen(false)}
              className="absolute inset-0 bg-black/40"
            />
            <div className="hukuk-panel absolute right-0 top-0 h-full w-full max-w-[420px] overflow-y-auto rounded-none border bg-white p-3 shadow-xl">
              <div className="mb-3 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={inspectorTab === 'sources' ? 'default' : 'outline'}
                  className="text-xs"
                  onClick={() => setInspectorTab('sources')}
                >
                  Kaynaklar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={inspectorTab === 'documents' ? 'default' : 'outline'}
                  className="text-xs"
                  onClick={() => setInspectorTab('documents')}
                >
                  Belgeler
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={inspectorTab === 'research' ? 'default' : 'outline'}
                  className="text-xs"
                  onClick={() => setInspectorTab('research')}
                >
                  Arastirma
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={inspectorTab === 'settings' ? 'default' : 'outline'}
                  className="text-xs"
                  onClick={() => setInspectorTab('settings')}
                >
                  Ayarlar
                </Button>
              </div>

              {inspectorTab === 'sources' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kaynak Listesi</p>
                    <Badge variant="muted" className="text-xs">
                      {(result?.sources ?? []).length}
                    </Badge>
                  </div>

                  {(result?.sources ?? []).length === 0 && (
                    <p className="text-xs text-slate-500">Henuz kaynak yok.</p>
                  )}

                  {(result?.sources ?? []).map((src, idx) => (
                    <div
                      id={`source-${idx + 1}`}
                      key={src.id ?? src.doc_id ?? `source-${idx + 1}`}
                      className={cn(
                        'hukuk-source-snap rounded-md border border-slate-200 p-2 text-xs text-slate-700',
                        activeSourceIndex === idx + 1 && splitViewOpen && 'border-blue-300 bg-blue-50/50',
                      )}
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <p className="font-semibold">[{idx + 1}] {src.title ?? src.citation ?? `Kaynak ${idx + 1}`}</p>
                        <Badge variant="muted" className="text-[11px]">
                          {SOURCE_CLASS_LABEL[src.quality_source_class ?? ''] ?? src.source_type ?? 'Kaynak'}
                        </Badge>
                      </div>
                      <p className="line-clamp-3 text-slate-600">{src.content}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {typeof src.page_no === 'number' && (
                          <Badge variant="muted" className="text-[11px]">
                            Sayfa {src.page_no}
                          </Badge>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          onClick={() => {
                            setActiveSourceIndex(idx + 1);
                            setSplitViewOpen(true);
                          }}
                        >
                          Snippeti ac
                        </Button>
                        {src.source_url && (
                          <a
                            href={src.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-50"
                          >
                            Kaynagi ac
                          </a>
                        )}
                      </div>
                    </div>
                  ))}

                  <SourceSplitViewer
                    sources={result?.sources ?? []}
                    selectedIndex={activeSourceIndex}
                    isOpen={splitViewOpen}
                    onSelect={(index) => setActiveSourceIndex(index)}
                    onClose={() => setSplitViewOpen(false)}
                  />
                </div>
              )}

              {inspectorTab === 'documents' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Belge Akisi</p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        disabled={isLoading || isUploading}
                        onClick={() => uploadInputRef.current?.click()}
                      >
                        <Upload className="mr-1 h-3.5 w-3.5" /> Belge Yukle
                      </Button>
                      {isUploading && (
                        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={handleCancelUpload}>
                          Durdur
                        </Button>
                      )}
                    </div>
                  </div>

                  {showUploadProgress && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600">
                        <span>Durum: {uploadStageLabel}</span>
                        <span>%{uploadProgressPct}</span>
                      </div>
                      <div className="hukuk-progress-scan h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${uploadProgressPct}%` }} />
                      </div>
                    </div>
                  )}

                  {isUploading && <p className="text-xs text-blue-700">Belge yukleme adimi calisiyor.</p>}
                  {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}

                  {uploadedDocuments.length === 0 ? (
                    <p className="text-xs text-slate-500">Yuklu belge bulunmuyor.</p>
                  ) : (
                    uploadedDocuments.map((doc) => (
                      <div key={doc.doc_id} className="rounded-md border border-slate-200 p-2 text-xs">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={doc.selected}
                            onChange={() =>
                              setUploadedDocuments((prev) =>
                                prev.map((item) =>
                                  item.doc_id === doc.doc_id ? { ...item, selected: !item.selected } : item,
                                ),
                              )
                            }
                            className="h-3.5 w-3.5"
                          />
                          <span className="flex-1 truncate text-slate-700">{doc.file_name}</span>
                          <button
                            type="button"
                            onClick={() => setUploadedDocuments((prev) => prev.filter((item) => item.doc_id !== doc.doc_id))}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            aria-label="Belgeyi kaldir"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {doc.warnings.length > 0 && <p className="mt-1 text-[11px] text-amber-700">{doc.warnings.join(' | ')}</p>}
                      </div>
                    ))
                  )}
                </div>
              )}

              {inspectorTab === 'research' && (
                <div className="space-y-2 text-xs text-slate-600">
                  <p className="font-semibold uppercase tracking-wide text-slate-500">Arastirma Sekmesi</p>
                  <div className="rounded-md border border-slate-200 p-2">
                    Kapsam: {chatModeLabel} | Mod: {selectedTierMeta.label}
                  </div>
                  <div className="rounded-md border border-slate-200 p-2">Kaynak turu filtresi: Kanun / Ictihat / Belge</div>
                  <div className="rounded-md border border-slate-200 p-2">
                    <p className="mb-2 font-medium text-slate-700">Arastirma adimlari</p>
                    <div className="space-y-1">
                      {RESEARCH_STAGE_ORDER.map((stage, index) => {
                        const status =
                          index < activeResearchIndex
                            ? 'Tamamlandi'
                            : index === activeResearchIndex
                              ? 'Aktif'
                              : 'Bekliyor';
                        return (
                          <div key={stage} className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1">
                            <span>{RESEARCH_STAGE_LABEL[stage]}</span>
                            <span className="text-[11px] text-slate-500">{status}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800">
                    Nihai hukuki gorus yerine gecmez. Kritik kararlar oncesi birincil kaynak dogrulamasi yapin.
                  </div>
                </div>
              )}

              {inspectorTab === 'settings' && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Chat Modu</p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={chatMode === ChatMode.GENERAL_CHAT ? 'default' : 'outline'}
                        className="h-8 text-xs"
                        onClick={() => setChatMode(ChatMode.GENERAL_CHAT)}
                        disabled={isLoading}
                      >
                        Genel Mod
                      </Button>
                      <Button
                        type="button"
                        variant={chatMode === ChatMode.DOCUMENT_ANALYSIS ? 'default' : 'outline'}
                        className="h-8 text-xs"
                        onClick={() => setChatMode(ChatMode.DOCUMENT_ANALYSIS)}
                        disabled={isLoading}
                      >
                        Belgeli Mod
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Case UUID (opsiyonel)</label>
                    <Input
                      placeholder="00000000-0000-0000-0000-000000000000"
                      value={queryCaseId}
                      onChange={(e) => setQueryCaseId(e.target.value)}
                      disabled={isLoading || isUploading}
                      className="text-xs"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowDateFields((value) => !value)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    Lehe Kanun / Zaman Alanlari
                    {showDateFields ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>

                  {showDateFields && (
                    <div className="grid gap-2">
                      <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="text-xs" />
                      <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="text-xs" />
                      <Input type="date" value={decisionDate} onChange={(e) => setDecisionDate(e.target.value)} className="text-xs" />
                    </div>
                  )}

                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
                    Koyu tema notu: Uzun hukuki metinlerde parlaklik/kontrast yorgunluk yaratirsa acik temada okumayi tercih edin.
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      <form onSubmit={handleSubmit} className="hukuk-panel sticky bottom-0 z-20 rounded-[28px] border bg-white/95 p-3 backdrop-blur">
        <div className="space-y-2">
          <div className="relative">
            <textarea
              ref={composerTextareaRef}
              placeholder="Sorunuzu yazın"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={3}
              className="hukuk-composer-textarea w-full resize-none rounded-[22px] border-0 bg-transparent px-3 py-2 pr-10 text-sm leading-relaxed placeholder:text-slate-400 focus:outline-none focus:ring-0 disabled:opacity-60"
              disabled={isUiBusy}
            />
            {isComposerScrollable && (
              <div className="absolute bottom-2 right-2 flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => scrollComposerContent('up')}
                  className="rounded border border-slate-200 bg-white p-1 text-slate-500 hover:text-slate-700"
                  aria-label="Yukari kaydir"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollComposerContent('down')}
                  className="rounded border border-slate-200 bg-white p-1 text-slate-500 hover:text-slate-700"
                  aria-label="Asagi kaydir"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="hukuk-plain-action h-8 px-2 text-xs"
                onClick={() => {
                  openInspector('documents');
                  uploadInputRef.current?.click();
                }}
                disabled={isUiBusy || isUploading}
              >
                + Belge
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="mode-select" className="text-xs text-slate-500">
                Mod
              </label>
              {featureFlags.tier_selector_ui ? (
                <select
                  id="mode-select"
                  value={effectiveSelectedTier}
                  onChange={(event) => setSelectedTier(event.target.value as AiTier)}
                  disabled={isUiBusy}
                  className="hukuk-mode-select h-8 rounded-md px-2 text-xs"
                >
                  {TIER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Badge variant="muted" className="text-xs">
                  Hazir Cevap
                </Badge>
              )}
              <Button
                type="submit"
                disabled={isUiBusy || !query.trim()}
                className={cn(
                  'h-9 w-9 rounded-full bg-slate-900 p-0 text-white hover:bg-slate-700',
                  sendButtonAnimation > 0 && 'is-strike',
                )}
                aria-label="Mesaji gonder"
                title="Gonder"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send
                    key={`send-icon-fallback-${sendButtonAnimation}`}
                    className={cn('h-5 w-5', sendButtonAnimation > 0 && 'hukuk-send-animation')}
                  />
                )}
              </Button>              
            </div>
          </div>

        </div>
      </form>
    </div>
  );
}
