/**
 * /api/rag - Next.js proxy to the FastAPI RAG backend.
 *
 * POST /api/rag
 *   Forwards to POST /api/v1/rag-v3/query while keeping server-side
 *   secrets and bureau headers out of the browser.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AiTier, ChatMode, ClientAction, ResponseDepth, ResponseType, SaveMode } from '@/types';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { fetchRagBackend, getRagBackendForLogs } from '@/app/api/rag/_lib/rag-backend';
import { createClient } from '@/utils/supabase/server';

const QUERY_FLAG_KEYS = ['strict_grounding_v2', 'tier_selector_ui', 'router_hybrid_v3'] as const;
type QueryFlagKey = (typeof QUERY_FLAG_KEYS)[number];

const DEFAULT_QUERY_FLAGS: Record<QueryFlagKey, boolean> = {
  strict_grounding_v2: true,
  tier_selector_ui: true,
  router_hybrid_v3: true,
};

const DEFAULT_NO_SOURCE_ACTIONS = [
  'Sorguyu daralt',
  'Tarih ekle (as_of_date / event_date / decision_date)',
  'Case sec',
  'Belge yukle',
] as const;

const TIER_TIMEOUT_MS: Record<AiTier, number> = {
  [AiTier.HAZIR_CEVAP]: 45_000,
  [AiTier.DUSUNCELI]: 70_000,
  [AiTier.UZMAN]: 95_000,
  [AiTier.MUAZZAM]: 120_000,
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function envOverride(flag: QueryFlagKey): boolean | null {
  const envName = `NEXT_PUBLIC_FEATURE_${flag.toUpperCase()}`;
  const raw = process.env[envName];
  if (raw === undefined) return null;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'no', 'disabled'].includes(normalized)) return false;
  return null;
}

async function resolveQueryFlags(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bureauId: string | null,
): Promise<Record<QueryFlagKey, boolean>> {
  const [globalResult, bureauResult] = await Promise.all([
    supabase
      .from('ai_feature_flags')
      .select('flag_key, is_enabled')
      .is('bureau_id', null)
      .in('flag_key', [...QUERY_FLAG_KEYS]),
    bureauId
      ? supabase
          .from('ai_feature_flags')
          .select('flag_key, is_enabled')
          .eq('bureau_id', bureauId)
          .in('flag_key', [...QUERY_FLAG_KEYS])
      : Promise.resolve({ data: [] as Array<{ flag_key: string; is_enabled: boolean }> }),
  ]);

  const merged: Record<QueryFlagKey, boolean> = { ...DEFAULT_QUERY_FLAGS };
  for (const row of globalResult.data ?? []) {
    const key = row.flag_key as QueryFlagKey;
    if (QUERY_FLAG_KEYS.includes(key)) merged[key] = Boolean(row.is_enabled);
  }
  for (const row of bureauResult.data ?? []) {
    const key = row.flag_key as QueryFlagKey;
    if (QUERY_FLAG_KEYS.includes(key)) merged[key] = Boolean(row.is_enabled);
  }
  for (const key of QUERY_FLAG_KEYS) {
    const override = envOverride(key);
    if (override !== null) merged[key] = override;
  }
  return merged;
}

function pickErrorMessage(body: unknown): string {
  const bodyObj = asObject(body);
  if (!bodyObj) return 'Backend hatasi olustu.';

  const detailObj = asObject(bodyObj.detail);
  if (typeof detailObj?.message === 'string') return detailObj.message;
  if (typeof bodyObj.error === 'string') return bodyObj.error;
  if (typeof bodyObj.message === 'string') return bodyObj.message;
  if (typeof bodyObj.detail === 'string') return bodyObj.detail;

  return 'Backend hatasi olustu.';
}

type RagV3Citation = {
  chunk_id?: string;
  document_id?: string;
  title?: string;
  source_id?: string;
  source_type?: string;
  article_no?: string | null;
  clause_no?: string | null;
  subclause_no?: string | null;
  page_range?: string | null;
  final_score?: number;
};

type RagV3Fingerprint = {
  model_name?: string;
  model_version?: string;
  prompt_version?: string;
};

type RagV3Structured = {
  confidence?: number;
  warnings?: string[];
};

type RagV3QueryPayload = {
  request_id?: string;
  answer: string;
  status: 'ok' | 'no_answer';
  gate_decision?: string;
  citations: RagV3Citation[];
  fingerprint: RagV3Fingerprint;
  structured: RagV3Structured;
  contract_version?: string;
  schema_version?: string;
};

function tierToNumber(tier: AiTier): number {
  if (tier === AiTier.HAZIR_CEVAP) return 1;
  if (tier === AiTier.DUSUNCELI) return 2;
  if (tier === AiTier.UZMAN) return 3;
  return 4;
}

function clampTopK(value: number | undefined): number {
  const raw = Number.isFinite(value) ? Number(value) : 10;
  return Math.max(8, Math.min(12, raw));
}

function toPageNo(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\d+/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function sourceClass(sourceType: string): string {
  const lowered = sourceType.toLowerCase();
  if (lowered.includes('law') || lowered.includes('legislation') || lowered.includes('kanun')) return 'kanun';
  if (lowered.includes('case') || lowered.includes('ictihat') || lowered.includes('mahkeme')) return 'ictihat';
  return 'ikincil_kaynak';
}

function splitAnswerSentences(answer: string): string[] {
  return answer
    .split(/(?<=[.!?])\s+|\n+/g)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .slice(0, 24);
}

function normalizeRagV3Response(body: unknown): RagV3QueryPayload | null {
  const obj = asObject(body);
  if (!obj) return null;
  const answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
  if (!answer) return null;
  const statusRaw = typeof obj.status === 'string' ? obj.status : 'ok';
  const status: 'ok' | 'no_answer' = statusRaw === 'no_answer' ? 'no_answer' : 'ok';
  const citations = Array.isArray(obj.citations)
    ? obj.citations.filter((item): item is RagV3Citation => item !== null && typeof item === 'object')
    : [];
  const fingerprint = asObject(obj.fingerprint) ?? {};
  const structured = asObject(obj.structured) ?? {};
  return {
    request_id: typeof obj.request_id === 'string' ? obj.request_id : undefined,
    answer,
    status,
    gate_decision: typeof obj.gate_decision === 'string' ? obj.gate_decision : undefined,
    citations,
    fingerprint,
    structured,
    contract_version: typeof obj.contract_version === 'string' ? obj.contract_version : undefined,
    schema_version: typeof obj.schema_version === 'string' ? obj.schema_version : undefined,
  };
}

function buildNoSourceHardFailResponse(strictGrounding: boolean, message?: string) {
  return {
    error_code: 'NO_SOURCE_HARD_FAIL',
    message:
      typeof message === 'string' && message.trim().length > 0
        ? message
        : 'Bu hukuki soru icin kaynak bulunamadi; bu nedenle yanit uretilmedi.',
    suggestions: [...DEFAULT_NO_SOURCE_ACTIONS],
    llm_called: false,
    strict_grounding: strictGrounding,
    intent_class: 'legal_query',
  };
}

function adaptRagV3ToLegacy(
  payload: RagV3QueryPayload,
  options: {
    selectedTier: AiTier;
    temporal: {
      as_of_date?: string;
      event_date?: string;
      decision_date?: string;
    };
  },
) {
  const sourceRefs = payload.status === 'ok' && payload.citations.length > 0 ? [1] : [];
  const sentences = splitAnswerSentences(payload.answer);
  const answerSentences = (sentences.length > 0 ? sentences : [payload.answer]).map((text, index) => ({
    sentence_id: index,
    text,
    source_refs: sourceRefs,
    is_grounded: sourceRefs.length > 0,
  }));

  const sources = payload.citations.map((citation, index) => {
    const anchor = [
      citation.source_id ? `source_id=${citation.source_id}` : null,
      citation.article_no ? `madde=${citation.article_no}` : null,
      citation.clause_no ? `fikra=${citation.clause_no}` : null,
      citation.subclause_no ? `bent=${citation.subclause_no}` : null,
    ]
      .filter(Boolean)
      .join('; ');
    const content = [
      citation.title ? `Baslik: ${citation.title}` : null,
      anchor ? `Atif: ${anchor}` : null,
      citation.page_range ? `Sayfa: ${citation.page_range}` : null,
      typeof citation.final_score === 'number' ? `Skor: ${citation.final_score.toFixed(3)}` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    const sourceType = String(citation.source_type ?? 'source');
    return {
      id: citation.chunk_id ?? `chunk-${index + 1}`,
      doc_id: citation.document_id ?? undefined,
      title: citation.title ?? citation.source_id ?? `Kaynak ${index + 1}`,
      citation: anchor || citation.source_id || `Kaynak ${index + 1}`,
      content: content || (citation.title ?? citation.source_id ?? 'Kaynak'),
      source_type: sourceType,
      source_origin: 'rag_v3',
      source_anchor: anchor || undefined,
      page_no: toPageNo(citation.page_range),
      final_score: typeof citation.final_score === 'number' ? citation.final_score : undefined,
      quality_source_class: sourceClass(sourceType),
    };
  });

  const groundedCount = answerSentences.filter((sentence) => sentence.is_grounded).length;
  const groundingRatio = answerSentences.length > 0 ? groundedCount / answerSentences.length : 0;
  const topScore = typeof sources[0]?.final_score === 'number' ? Number(sources[0].final_score) : 0;
  const sourceStrength = topScore >= 0.75 ? 'Yuksek' : topScore >= 0.45 ? 'Orta' : 'Dusuk';

  const sourceTypeDistribution: Record<string, number> = {};
  for (const source of sources) {
    const key = String(source.quality_source_class || 'ikincil_kaynak');
    sourceTypeDistribution[key] = (sourceTypeDistribution[key] ?? 0) + 1;
  }

  const modelName = String(payload.fingerprint.model_name ?? '').trim();
  const modelVersion = String(payload.fingerprint.model_version ?? '').trim();
  const promptVersion = String(payload.fingerprint.prompt_version ?? '').trim();
  const modelUsed = modelVersion || modelName || 'rag_v3';
  const auditTrailId =
    (typeof payload.request_id === 'string' && payload.request_id.trim().length > 0)
      ? payload.request_id.trim()
      : `ragv3-${Date.now()}`;

  return {
    response_type: ResponseType.LEGAL_GROUNDED,
    answer: payload.answer,
    answer_sentences: answerSentences,
    sources,
    tier_used: tierToNumber(options.selectedTier),
    model_used: modelUsed,
    grounding_ratio: payload.status === 'no_answer' ? 0 : groundingRatio,
    citation_quality_summary: `Kaynak sayisi: ${sources.length}${promptVersion ? ` | prompt=${promptVersion}` : ''}`,
    citation_quality: {
      source_strength: sourceStrength,
      source_count: sources.length,
      source_type_distribution: sourceTypeDistribution,
      recency_label: 'Karisik',
      average_support_span: 0,
      average_citation_confidence: payload.status === 'no_answer' ? 0 : groundingRatio,
    },
    estimated_cost: 0,
    cost_estimate: {
      model_id: modelUsed,
      tier: tierToNumber(options.selectedTier),
      input_tokens: 0,
      output_tokens: 0,
      total_cost_usd: 0,
      cached: false,
      rate_per_1m_in: 0,
      rate_per_1m_out: 0,
    },
    audit_trail_id: auditTrailId,
    temporal_fields: options.temporal,
    legal_disclaimer: {
      disclaimer_text:
        'Nihai hukuki gorus yerine gecmez. Kritik adimlardan once birincil kaynak dogrulamasi yapin.',
      severity: 'info',
      requires_expert: false,
      disclaimer_types: ['GENEL_HUKUKI'],
    },
    aym_warnings: [],
  };
}

const requestSchema = z.object({
  query: z.string().min(1, 'Sorgu bos olamaz.').max(2000, 'Sorgu cok uzun.'),
  thread_id: z.string().uuid().optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(4000),
  })).max(20).optional(),
  chat_mode: z.nativeEnum(ChatMode).default(ChatMode.GENERAL_CHAT),
  ai_tier: z.nativeEnum(AiTier).default(AiTier.HAZIR_CEVAP),
  response_depth: z.nativeEnum(ResponseDepth).default(ResponseDepth.STANDARD),
  case_id: z.string().uuid().optional(),
  as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-AA-GG formati gerekli.').optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-AA-GG formati gerekli.').optional(),
  decision_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-AA-GG formati gerekli.').optional(),
  max_sources: z.number().int().min(1).max(20).optional(),
  // Backward-compat alias, mapped to max_sources when max_sources is absent.
  top_k: z.number().int().min(1).max(20).optional(),
  strict_grounding: z.boolean().optional(),
  active_document_ids: z.array(z.string().uuid()).optional(),
  save_mode: z.nativeEnum(SaveMode).optional(),
  client_action: z.nativeEnum(ClientAction).optional(),
});

export type RagQueryPayload = z.infer<typeof requestSchema>;

export async function POST(req: Request) {
  try {
    const parsed = requestSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' ') }, { status: 400 });
    }

    const supabase = await createClient();
    let context;
    try {
      context = await resolveBureauContext(supabase);
    } catch {
      return NextResponse.json({ error: 'Oturum bulunamadi. Lutfen tekrar giris yapin.' }, { status: 401 });
    }

    const { bureauId, userId, planTier, messagesToday, tokensUsedMonth } = context;

    const flags = await resolveQueryFlags(supabase, bureauId);
    const { top_k, ...restPayload } = parsed.data;
    const effectiveTier = flags.tier_selector_ui ? restPayload.ai_tier : AiTier.HAZIR_CEVAP;
    const effectiveStrictGrounding = flags.strict_grounding_v2
      ? (
          effectiveTier === AiTier.HAZIR_CEVAP
            ? false
            : (restPayload.strict_grounding ?? true)
        )
      : false;

    const requestedTierNumber = tierToNumber(effectiveTier);
    const effectiveTopK = clampTopK(
      restPayload.max_sources ?? top_k ?? 10,
    );
    const upstreamPayload = {
      query: restPayload.query,
      top_k: effectiveTopK,
      jurisdiction: 'TR',
      as_of_date: restPayload.as_of_date,
      acl_tags: ['public'],
      requested_tier: requestedTierNumber,
    };
    const timeoutMs = TIER_TIMEOUT_MS[effectiveTier] ?? 95_000;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-User-ID': userId,
      'X-Router-Hybrid-V3': flags.router_hybrid_v3 ? '1' : '0',
      'X-Plan-Tier': planTier,
    };
    if (typeof messagesToday === 'number' && Number.isFinite(messagesToday) && messagesToday >= 0) {
      headers['X-Messages-Today'] = String(Math.trunc(messagesToday));
    }
    if (typeof tokensUsedMonth === 'number' && Number.isFinite(tokensUsedMonth) && tokensUsedMonth >= 0) {
      headers['X-Tokens-Used-Month'] = String(Math.trunc(tokensUsedMonth));
    }
    if (bureauId) {
      headers['X-Bureau-ID'] = bureauId;
    } else {
      // Keep query path functional when profile is incomplete; middleware only
      // requires a syntactically valid UUID and user id is UUID in Supabase.
      headers['X-Bureau-ID'] = userId;
    }

    const upstream = await fetchRagBackend('/api/v1/rag-v3/query', {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamPayload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    let body: unknown = null;
    try {
      body = await upstream.json();
    } catch {
      body = null;
    }

    if (!upstream.ok) {
      const bodyObj = asObject(body);
      const detailObj = asObject(bodyObj?.detail);

      return NextResponse.json(
        {
          error: pickErrorMessage(body),
          error_code: typeof detailObj?.error_code === 'string' ? detailObj.error_code : undefined,
        },
        { status: upstream.status },
      );
    }
    const normalized = normalizeRagV3Response(body);
    if (!normalized) {
      return NextResponse.json(
        { error: 'RAG v3 yaniti gecersiz veya eksik.' },
        { status: 503 },
      );
    }
    const noSourceHardFail =
      effectiveStrictGrounding
      && normalized.status === 'no_answer'
      && normalized.citations.length === 0;
    if (noSourceHardFail) {
      return NextResponse.json(
        buildNoSourceHardFailResponse(effectiveStrictGrounding, normalized.answer),
        { status: 422 },
      );
    }

    const adapted = adaptRagV3ToLegacy(normalized, {
      selectedTier: effectiveTier,
      temporal: {
        as_of_date: restPayload.as_of_date,
        event_date: restPayload.event_date,
        decision_date: restPayload.decision_date,
      },
    });
    return NextResponse.json(adapted, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Istek zaman asimina ugradi. Lutfen tekrar deneyin.'
        : 'Sunucu baglanti hatasi.';
    console.error('[RAG proxy]', err, { backendCandidates: getRagBackendForLogs() });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
