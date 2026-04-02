import {
  SEARCH_PAGE_SIZE,
  registerLiveSearchAdapter,
  SearchBackendContractError,
} from '@/lib/source-search/search-service';
import type {
  AdapterScope,
  DocumentRecord,
  SearchFilters,
  SearchRequestInput,
  SearchResultPayload,
  SearchSort,
  SearchTab,
  SourceAdapterStatus,
} from '@/lib/source-search/types';

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
  evidence_text?: string | null;
  citation_date?: string | null;
  issuing_authority?: string | null;
  decision_no?: string | null;
};

type RagV3SourceDocument = {
  document_id?: string;
  source_id?: string;
  title?: string;
  source_type?: string;
  article_no?: string | null;
  clause_no?: string | null;
  subclause_no?: string | null;
  page_range?: string | null;
  citation_date?: string | null;
  issuing_authority?: string | null;
  decision_no?: string | null;
  reference_no?: string | null;
  final_score?: number;
};

type RagV3QueryResponse = {
  status?: string;
  gate_decision?: string;
  answer?: string;
  answer_text?: string;
  warnings?: string[];
  source_documents: RagV3SourceDocument[];
  citations: RagV3Citation[];
};

interface ScoredLiveDocument {
  item: DocumentRecord;
  score: number;
  timestamp: number;
}

const DEFAULT_RAG_BACKEND_URLS = ['http://127.0.0.1:8000', 'http://127.0.0.1:8001'];
let adapterRegistered = false;

type LiveAdapterDescriptor = {
  id: string;
  scope: AdapterScope;
  sourceName: string;
  tab: SearchTab;
};

const LIVE_TAB_ADAPTERS: Record<SearchTab, LiveAdapterDescriptor | null> = {
  ictihat: {
    id: 'rag-v3-case-law-live',
    scope: 'case_law',
    sourceName: 'RAG v3 Case Law Adapter',
    tab: 'ictihat',
  },
  mevzuat: {
    id: 'rag-v3-legislation-live',
    scope: 'legislation',
    sourceName: 'RAG v3 Legislation Adapter',
    tab: 'mevzuat',
  },
  akademik: null,
  web: null,
};

export function ensureLiveSearchAdapterRegistered(): void {
  if (adapterRegistered) {
    return;
  }
  registerLiveSearchAdapter({
    search: searchLiveDocuments,
  });
  adapterRegistered = true;
}

async function searchLiveDocuments(input: SearchRequestInput): Promise<SearchResultPayload> {
  const tabAdapter = resolveTabAdapter(input.tab);
  const topK = clampInt(Math.max(SEARCH_PAGE_SIZE, input.page * SEARCH_PAGE_SIZE), 8, 20);
  const body = {
    query: buildLiveQuery(input),
    top_k: topK,
    jurisdiction: resolveJurisdiction(),
    requested_tier: resolveTier(),
    acl_tags: resolveAclTags(),
    policy_context: buildPolicyContext(input),
    legal_disclaimer_ack: true,
    human_responsibility_ack: true,
    selected_mode: 'source_search_live',
  };

  const response = await callRagBackend(body);
  const candidates = buildLiveCandidates({
    response,
    requestedTab: input.tab,
    query: input.q,
  })
    .filter((entry) => entry.item.source_type === input.tab)
    .filter((entry) => matchesFilters(entry.item, input.tab, input.filters));

  candidates.sort((left, right) => compareDocuments(left, right, input.sort));
  const total = candidates.length;
  const startIndex = (input.page - 1) * SEARCH_PAGE_SIZE;
  const items = candidates.slice(startIndex, startIndex + SEARCH_PAGE_SIZE).map((entry) => entry.item);

  const warnings = Array.from(
    new Set([
      ...(response.warnings ?? []),
      ...(response.status === 'no_answer' ? ['Canli retrieval no_answer dondu; arama sonucu kisitli olabilir.'] : []),
      ...(input.page > 2 ? ['Canli backend top_k=20 siniri nedeniyle 2. sayfa sonrasi sonuc kisitli olabilir.'] : []),
      ...(total === 0 ? ['Canli retrieval sonucunda filtreye uygun dokuman bulunamadi.'] : []),
    ]),
  );

  return {
    items,
    total,
    page: input.page,
    page_size: SEARCH_PAGE_SIZE,
    warnings,
    partial_sources: [],
    adapters: [activeAdapterStatus(tabAdapter)],
  };
}

function resolveTabAdapter(tab: SearchTab): LiveAdapterDescriptor {
  const adapter = LIVE_TAB_ADAPTERS[tab];
  if (!adapter) {
    throw new SearchBackendContractError(
      'LIVE_SEARCH_TAB_UNAVAILABLE',
      `Canli arama adaptoru bu sekme icin hazir degil: ${tab}.`,
      503,
    );
  }
  return adapter;
}

function activeAdapterStatus(adapter: LiveAdapterDescriptor): SourceAdapterStatus {
  return {
    adapter_id: adapter.id,
    scope: adapter.scope,
    tab: adapter.tab,
    source_name: adapter.sourceName,
    mode: 'ACTIVE',
    verification_required: true,
    assumption: 'Canli arama sonuclari RAG v3 retrieval ve kaynakli cevap izinden uretilir.',
    validation_step: 'Upstream response contracti ve source_documents/citations alanlari dogrulandi.',
    fallback_action: 'Fail-closed: upstream hata durumunda sonuc uretme, hata dondur.',
  };
}

function buildPolicyContext(input: SearchRequestInput): Record<string, unknown> {
  const policy: Record<string, unknown> = {
    purpose_of_use: 'search',
    retrieval_filters: buildRetrievalFilters(input.filters),
  };
  if (input.tab === 'ictihat') {
    policy.source_type_hint = 'case_law';
  } else if (input.tab === 'mevzuat') {
    policy.source_type_hint = 'legislation';
  } else if (input.tab === 'akademik') {
    policy.source_type_hint = 'academic';
  } else {
    policy.source_type_hint = 'web';
  }
  return policy;
}

function buildRetrievalFilters(filters: SearchFilters): Record<string, string> {
  const out: Record<string, string> = {};
  const copyIf = (key: string, value: string | undefined) => {
    const token = (value ?? '').trim();
    if (token.length > 0) {
      out[key] = token;
    }
  };

  copyIf('source_type', filters.source_type);
  copyIf('court', filters.court);
  copyIf('chamber', filters.chamber);
  copyIf('decision_date_from', filters.decision_date_from ?? filters.date_from);
  copyIf('decision_date_to', filters.decision_date_to ?? filters.date_to);
  copyIf('law_no', filters.law_no);
  copyIf('article_no', filters.article_no ?? filters.article);
  copyIf('docket_no', filters.docket_no ?? filters.esas_no);
  copyIf('decision_no', filters.decision_no ?? filters.karar_no);

  return out;
}

function buildLiveQuery(input: SearchRequestInput): string {
  const scopeHint =
    input.tab === 'ictihat'
      ? 'Sadece ictihat/mahkeme kararlarini getir.'
      : input.tab === 'mevzuat'
        ? 'Sadece mevzuat/kanun kaynaklarini getir.'
        : input.tab === 'akademik'
          ? 'Sadece akademik hukuk kaynaklarini getir.'
          : 'Sadece resmi web kaynaklarini getir.';

  const filterHints = Object.entries(input.filters)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([key, value]) => `${key}=${String(value).trim()}`);

  return [input.q.trim(), scopeHint, filterHints.length > 0 ? `Filtreler: ${filterHints.join('; ')}` : '']
    .filter((entry) => entry.length > 0)
    .join('\n');
}

function resolveTier(): number {
  return clampInt(Number(process.env.SEARCH_LIVE_RAG_TIER ?? 2), 1, 4);
}

function resolveJurisdiction(): string {
  const value = (process.env.SEARCH_LIVE_JURISDICTION ?? 'TR').trim().toUpperCase();
  return value || 'TR';
}

function resolveAclTags(): string[] {
  const raw = process.env.SEARCH_LIVE_ACL_TAGS ?? 'public,internal';
  const tags = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  return Array.from(new Set(tags));
}

function resolveHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const bureauId = (process.env.SEARCH_LIVE_BUREAU_ID ?? '').trim();
  if (bureauId) {
    headers['X-Bureau-ID'] = bureauId;
  }
  const userId = (process.env.SEARCH_LIVE_USER_ID ?? '').trim();
  if (userId) {
    headers['X-User-ID'] = userId;
  }
  const accessLevel = (process.env.SEARCH_LIVE_ACCESS_LEVEL ?? 'MEMBER').trim().toUpperCase();
  if (accessLevel) {
    headers['X-Access-Level'] = accessLevel;
  }
  const bearer = (process.env.SEARCH_LIVE_BEARER_TOKEN ?? '').trim();
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }
  return headers;
}

function normalizeOrigin(raw: string | undefined | null): string | null {
  if (!raw) {
    return null;
  }
  const value = raw.trim();
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function resolveRagBackendCandidates(): string[] {
  const explicit = (process.env.SEARCH_LIVE_RAG_BACKEND_URLS ?? '')
    .split(',')
    .map((item) => normalizeOrigin(item))
    .filter((item): item is string => item !== null);
  if (explicit.length > 0) {
    return Array.from(new Set(explicit));
  }

  const preferred =
    normalizeOrigin(process.env.SEARCH_LIVE_RAG_BACKEND_URL) ??
    normalizeOrigin(process.env.RAG_BACKEND_URL);
  if (preferred) {
    const candidates = [preferred];
    const sibling = localSiblingPort(preferred);
    if (sibling) {
      candidates.push(sibling);
    }
    return Array.from(new Set(candidates));
  }

  const listFromRag = (process.env.RAG_BACKEND_URLS ?? '')
    .split(',')
    .map((item) => normalizeOrigin(item))
    .filter((item): item is string => item !== null);
  if (listFromRag.length > 0) {
    return Array.from(new Set(listFromRag));
  }

  if (isProductionSearchRuntime()) {
    throw new SearchBackendContractError(
      'LIVE_SEARCH_BACKEND_MISCONFIGURED',
      'Uretim ortaminda canli backend URL tanimi zorunlu (SEARCH_LIVE_RAG_BACKEND_URL[S]).',
      503,
    );
  }

  return [...DEFAULT_RAG_BACKEND_URLS];
}

function isProductionSearchRuntime(): boolean {
  return (
    (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production' ||
    (process.env.VERCEL_ENV ?? '').trim().toLowerCase() === 'production' ||
    (process.env.APP_ENV ?? '').trim().toLowerCase() === 'production'
  );
}

function localSiblingPort(origin: string): string | null {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
      return null;
    }
    const currentPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    if (currentPort === '8000') {
      parsed.port = '8001';
      return parsed.origin;
    }
    if (currentPort === '8001') {
      parsed.port = '8000';
      return parsed.origin;
    }
    return null;
  } catch {
    return null;
  }
}

function resolveTimeoutMs(): number {
  return clampInt(Number(process.env.SEARCH_LIVE_TIMEOUT_MS ?? 12000), 1000, 120000);
}

async function callRagBackend(payload: Record<string, unknown>): Promise<RagV3QueryResponse> {
  const candidates = resolveRagBackendCandidates();
  const headers = resolveHeaders();
  const timeoutMs = resolveTimeoutMs();
  let lastError: unknown = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const baseUrl = candidates[index];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/api/v1/rag-v3/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await safeJson(response);
      if (response.ok) {
        return normalizeRagV3Response(body);
      }
      const message = pickErrorMessage(body) || `Canli backend ${response.status} ile hata dondu.`;
      if (response.status >= 500 && index < candidates.length - 1) {
        lastError = new Error(message);
        continue;
      }
      throw new SearchBackendContractError('LIVE_SEARCH_BACKEND_REJECTED', message, response.status);
    } catch (error) {
      if (error instanceof SearchBackendContractError && error.status < 500) {
        throw error;
      }
      lastError = error;
      if (index === candidates.length - 1) {
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : 'unknown error';
  throw new SearchBackendContractError(
    'LIVE_SEARCH_BACKEND_UNAVAILABLE',
    `Canli arama backendine baglanilamadi: ${reason}`,
    503,
  );
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickErrorMessage(body: unknown): string {
  const obj = asObject(body);
  if (!obj) {
    return '';
  }
  if (typeof obj.detail === 'string' && obj.detail.trim().length > 0) {
    return obj.detail;
  }
  if (typeof obj.error === 'string' && obj.error.trim().length > 0) {
    return obj.error;
  }
  if (typeof obj.message === 'string' && obj.message.trim().length > 0) {
    return obj.message;
  }
  const detailObj = asObject(obj.detail);
  if (detailObj && typeof detailObj.message === 'string' && detailObj.message.trim().length > 0) {
    return detailObj.message;
  }
  return '';
}

function normalizeRagV3Response(body: unknown): RagV3QueryResponse {
  const obj = asObject(body);
  if (!obj) {
    throw new SearchBackendContractError('LIVE_SEARCH_BACKEND_INVALID_RESPONSE', 'Canli backend cevabi JSON obje degil.', 502);
  }
  const sourceDocuments = Array.isArray(obj.source_documents)
    ? obj.source_documents.map((item) => normalizeSourceDocument(item)).filter((item): item is RagV3SourceDocument => item !== null)
    : [];
  const citations = Array.isArray(obj.citations)
    ? obj.citations.map((item) => normalizeCitation(item)).filter((item): item is RagV3Citation => item !== null)
    : [];
  const warnings = Array.isArray(obj.warnings)
    ? obj.warnings
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
  return {
    status: typeof obj.status === 'string' ? obj.status : undefined,
    gate_decision: typeof obj.gate_decision === 'string' ? obj.gate_decision : undefined,
    answer: typeof obj.answer === 'string' ? obj.answer : undefined,
    answer_text: typeof obj.answer_text === 'string' ? obj.answer_text : undefined,
    warnings,
    source_documents: sourceDocuments,
    citations,
  };
}

function normalizeSourceDocument(value: unknown): RagV3SourceDocument | null {
  const obj = asObject(value);
  if (!obj) {
    return null;
  }
  return {
    document_id: toTrimmedString(obj.document_id),
    source_id: toTrimmedString(obj.source_id),
    title: toTrimmedString(obj.title),
    source_type: toTrimmedString(obj.source_type),
    article_no: toTrimmedString(obj.article_no),
    clause_no: toTrimmedString(obj.clause_no),
    subclause_no: toTrimmedString(obj.subclause_no),
    page_range: toTrimmedString(obj.page_range),
    citation_date: toTrimmedString(obj.citation_date),
    issuing_authority: toTrimmedString(obj.issuing_authority),
    decision_no: toTrimmedString(obj.decision_no),
    reference_no: toTrimmedString(obj.reference_no),
    final_score: toFiniteNumber(obj.final_score),
  };
}

function normalizeCitation(value: unknown): RagV3Citation | null {
  const obj = asObject(value);
  if (!obj) {
    return null;
  }
  return {
    chunk_id: toTrimmedString(obj.chunk_id),
    document_id: toTrimmedString(obj.document_id),
    title: toTrimmedString(obj.title),
    source_id: toTrimmedString(obj.source_id),
    source_type: toTrimmedString(obj.source_type),
    article_no: toTrimmedString(obj.article_no),
    clause_no: toTrimmedString(obj.clause_no),
    subclause_no: toTrimmedString(obj.subclause_no),
    page_range: toTrimmedString(obj.page_range),
    final_score: toFiniteNumber(obj.final_score),
    evidence_text: toTrimmedString(obj.evidence_text),
    citation_date: toTrimmedString(obj.citation_date),
    issuing_authority: toTrimmedString(obj.issuing_authority),
    decision_no: toTrimmedString(obj.decision_no),
  };
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function buildLiveCandidates(params: {
  response: RagV3QueryResponse;
  requestedTab: SearchTab;
  query: string;
}): ScoredLiveDocument[] {
  const { response, requestedTab, query } = params;
  const answerText = response.answer_text ?? response.answer ?? '';
  const groupedCitations = new Map<string, RagV3Citation[]>();

  for (const citation of response.citations) {
    const key = citation.document_id ?? citation.source_id;
    if (!key) {
      continue;
    }
    const bucket = groupedCitations.get(key) ?? [];
    bucket.push(citation);
    groupedCitations.set(key, bucket);
  }

  const scored: ScoredLiveDocument[] = [];
  const seenIds = new Set<string>();
  const nowIso = new Date().toISOString();
  const sourceDocs = response.source_documents.length > 0 ? response.source_documents : response.citations.map((item) => ({
    document_id: item.document_id,
    source_id: item.source_id,
    title: item.title,
    source_type: item.source_type,
    article_no: item.article_no,
    clause_no: item.clause_no,
    subclause_no: item.subclause_no,
    page_range: item.page_range,
    citation_date: item.citation_date,
    issuing_authority: item.issuing_authority,
    decision_no: item.decision_no,
    final_score: item.final_score,
  }));

  sourceDocs.forEach((doc, index) => {
    const key = doc.document_id ?? doc.source_id ?? `live-${index}`;
    const citations = groupedCitations.get(key) ?? [];
    const bestCitation = pickBestCitation(citations);
    const inferredTab = inferTab({
      sourceType: doc.source_type,
      title: doc.title,
      sourceId: doc.source_id,
      fallback: requestedTab,
    });
    const sourceName = inferSourceName({
      issuingAuthority: doc.issuing_authority ?? undefined,
      sourceId: doc.source_id ?? undefined,
      inferredTab,
    });
    const decisionNo = doc.decision_no ?? bestCitation?.decision_no;
    const parsedDecision = parseDecisionNumbers(decisionNo ?? doc.source_id ?? doc.title ?? '');
    const dateValue = doc.citation_date ?? bestCitation?.citation_date;
    const snippet = (bestCitation?.evidence_text ?? answerText).trim() || (doc.title ?? '').trim();
    const title = (doc.title ?? bestCitation?.title ?? doc.source_id ?? `Canli Kaynak ${index + 1}`).trim();
    const idSeedBase = `${doc.document_id ?? ''}|${doc.source_id ?? ''}|${title}`;
    const idSeed = idSeedBase.replace(/\|/g, '').trim().length > 0 ? idSeedBase : `fallback|${index}`;
    const id = buildDocumentId(idSeed);
    if (seenIds.has(id)) {
      return;
    }
    seenIds.add(id);

    const score = clamp01(
      Math.max(
        doc.final_score ?? 0,
        bestCitation?.final_score ?? 0,
        0.35,
      ),
    );
    const entry: DocumentRecord = {
      id,
      source_type: inferredTab,
      source_name: sourceName,
      court: inferredTab === 'ictihat' ? sourceName : null,
      chamber: inferredTab === 'ictihat' ? inferChamber(title) : null,
      decision_date: inferredTab === 'ictihat' ? normalizeIsoDate(dateValue) : null,
      publish_date: inferredTab !== 'ictihat' ? normalizeIsoDate(dateValue) : null,
      esas_no: parsedDecision.esasNo ?? null,
      karar_no: parsedDecision.kararNo ?? null,
      title,
      snippet: snippet.slice(0, 600),
      full_text: null,
      authors: inferredTab === 'akademik' ? inferAuthors(title) : null,
      doi: inferredTab === 'akademik' ? inferDoi(doc.source_id, title) : null,
      tags: buildTags({
        inferredTab,
        sourceType: doc.source_type ?? undefined,
        issuingAuthority: doc.issuing_authority ?? undefined,
        articleNo: doc.article_no,
        clauseNo: doc.clause_no,
        query,
      }),
      url_original: inferSourceUrl(inferredTab, doc.source_id ?? undefined, sourceName),
      created_at: nowIso,
      updated_at: nowIso,
    };
    scored.push({
      item: entry,
      score,
      timestamp: parseDateValue(entry.decision_date) || parseDateValue(entry.publish_date),
    });
  });

  return scored;
}

function buildDocumentId(seed: string): string {
  const normalized = seed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
  if (normalized.length > 0) {
    return `live-${normalized}`;
  }
  return `live-${hashShort(seed)}`;
}

function hashShort(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function pickBestCitation(citations: RagV3Citation[]): RagV3Citation | undefined {
  const ordered = [...citations].sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));
  return ordered[0];
}

function inferSourceName(params: {
  issuingAuthority?: string;
  sourceId?: string;
  inferredTab: SearchTab;
}): string {
  if (params.issuingAuthority && params.issuingAuthority.trim().length > 0) {
    return params.issuingAuthority.trim();
  }
  if (params.sourceId) {
    try {
      const parsed = new URL(params.sourceId);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      // noop
    }
  }
  if (params.inferredTab === 'ictihat') return 'Mahkeme Kaynagi';
  if (params.inferredTab === 'mevzuat') return 'Mevzuat Kaynagi';
  if (params.inferredTab === 'akademik') return 'Akademik Kaynak';
  return 'Web Kaynagi';
}

function inferTab(params: {
  sourceType?: string;
  title?: string;
  sourceId?: string;
  fallback: SearchTab;
}): SearchTab {
  const blob = `${params.sourceType ?? ''} ${params.title ?? ''} ${params.sourceId ?? ''}`.toLowerCase();
  if (
    blob.includes('case_law') ||
    blob.includes('ictihat') ||
    blob.includes('mahkeme') ||
    blob.includes('yargitay') ||
    blob.includes('danistay') ||
    blob.includes('anayasa')
  ) {
    return 'ictihat';
  }
  if (
    blob.includes('legislation') ||
    blob.includes('kanun') ||
    blob.includes('mevzuat') ||
    blob.includes('yonetmelik') ||
    blob.includes('teblig')
  ) {
    return 'mevzuat';
  }
  if (
    blob.includes('akademik') ||
    blob.includes('journal') ||
    blob.includes('dergi') ||
    blob.includes('doi')
  ) {
    return 'akademik';
  }
  if (blob.includes('web') || blob.includes('http://') || blob.includes('https://')) {
    return 'web';
  }
  return params.fallback;
}

function inferChamber(title: string): string | null {
  const match = title.match(/(\d+\.\s*(?:hukuk|ceza)?\s*daire(?:si)?|genel kurul|ceza genel kurulu)/i);
  if (!match) {
    return null;
  }
  return match[1].trim();
}

function inferAuthors(title: string): string[] | null {
  const byMatch = title.match(/(?:yazar|authors?)[:\s]+([a-zA-Z ,.'-]{3,})/i);
  if (!byMatch) {
    return null;
  }
  const authors = byMatch[1]
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 2);
  return authors.length > 0 ? authors.slice(0, 5) : null;
}

function inferDoi(sourceId?: string, title?: string): string | null {
  const blob = `${sourceId ?? ''} ${title ?? ''}`;
  const match = blob.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
  return match ? match[0] : null;
}

function buildTags(params: {
  inferredTab: SearchTab;
  sourceType?: string;
  issuingAuthority?: string;
  articleNo?: string | null;
  clauseNo?: string | null;
  query: string;
}): string[] {
  const terms = params.query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 4);
  const tags = [
    params.inferredTab,
    params.sourceType?.toLowerCase(),
    params.issuingAuthority?.toLowerCase(),
    params.articleNo ? `madde-${params.articleNo}` : undefined,
    params.clauseNo ? `fikra-${params.clauseNo}` : undefined,
    ...terms,
  ]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  return Array.from(new Set(tags));
}

function inferSourceUrl(tab: SearchTab, sourceId: string | undefined, sourceName: string): string {
  if (sourceId) {
    try {
      const url = new URL(sourceId);
      return url.toString();
    } catch {
      // noop
    }
  }
  const normalizedName = sourceName.toLowerCase();
  if (tab === 'ictihat') {
    if (normalizedName.includes('yargitay')) return 'https://karararama.yargitay.gov.tr/';
    if (normalizedName.includes('danistay')) return 'https://www.danistay.gov.tr/';
    if (normalizedName.includes('aym')) return 'https://kararlarbilgibankasi.anayasa.gov.tr/';
    return 'https://www.turkiye.gov.tr/';
  }
  if (tab === 'mevzuat') {
    return 'https://www.mevzuat.gov.tr/';
  }
  if (tab === 'akademik') {
    return 'https://dergipark.org.tr/';
  }
  return 'https://www.google.com/';
}

function parseDecisionNumbers(rawText: string): { esasNo?: string; kararNo?: string } {
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  const esasMatch =
    normalized.match(/e\.?\s*[:\-]?\s*(\d{4}\/\d+)/i) ??
    normalized.match(/(\d{4}\/\d+)\s*e\.?/i);
  const kararMatch =
    normalized.match(/k\.?\s*[:\-]?\s*(\d{4}\/\d+)/i) ??
    normalized.match(/(\d{4}\/\d+)\s*k\.?/i);
  return {
    esasNo: esasMatch?.[1],
    kararNo: kararMatch?.[1],
  };
}

function normalizeIsoDate(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseDateValue(value?: string | null): number {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function contains(haystack: string | null | undefined, needle: string | undefined): boolean {
  if (!needle || needle.trim().length === 0) {
    return true;
  }
  return (haystack ?? '').toLowerCase().includes(needle.trim().toLowerCase());
}

function matchesDateRange(value: string | null | undefined, from?: string, to?: string): boolean {
  const timestamp = parseDateValue(value);
  if (!timestamp) {
    return !from && !to;
  }
  if (from && timestamp < parseDateValue(from)) {
    return false;
  }
  if (to) {
    const endOfDay = parseDateValue(to) + 86_399_000;
    if (timestamp > endOfDay) {
      return false;
    }
  }
  return true;
}

function matchesFilters(document: DocumentRecord, tab: SearchTab, filters: SearchFilters): boolean {
  if (filters.source_type && !contains(document.source_type, filters.source_type)) return false;

  if (tab === 'ictihat') {
    if (!contains(document.source_name, filters.source_name)) return false;
    if (!contains(document.court, filters.court)) return false;
    if (!contains(document.chamber, filters.chamber)) return false;
    if (!contains(document.esas_no, filters.esas_no ?? filters.docket_no)) return false;
    if (!contains(document.karar_no, filters.karar_no ?? filters.decision_no)) return false;
    if (!matchesDateRange(
      document.decision_date,
      filters.decision_date_from ?? filters.date_from,
      filters.decision_date_to ?? filters.date_to,
    )) return false;
    return true;
  }
  if (tab === 'mevzuat') {
    if (!contains(document.title, filters.law_name) && !contains(document.snippet, filters.law_name)) return false;
    if (!contains(document.title, filters.law_no)) return false;
    if (!contains(document.title, filters.article ?? filters.article_no)
      && !contains(document.snippet, filters.article ?? filters.article_no)) return false;
    if (!contains(document.source_name, filters.official_gazette)) return false;
    if (!matchesDateRange(document.publish_date, filters.publish_date_from, filters.publish_date_to)) return false;
    return true;
  }
  if (tab === 'akademik') {
    if (!contains(document.source_name, filters.journal)) return false;
    if (!contains(document.publish_date, filters.year)) return false;
    if (!contains(document.title, filters.keyword) && !contains(document.snippet, filters.keyword)) return false;
    if (!contains(document.authors?.join(' '), filters.author)) return false;
    if (!contains(document.doi, filters.doi)) return false;
    return true;
  }
  if (!contains(document.url_original, filters.domain)) return false;
  if (!matchesDateRange(document.publish_date, filters.publish_date_from, filters.publish_date_to)) return false;
  return true;
}

function compareDocuments(left: ScoredLiveDocument, right: ScoredLiveDocument, sort: SearchSort): number {
  if (sort === 'date_desc') {
    return right.timestamp - left.timestamp || right.score - left.score;
  }
  if (sort === 'date_asc') {
    return left.timestamp - right.timestamp || right.score - left.score;
  }
  return right.score - left.score || right.timestamp - left.timestamp;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
