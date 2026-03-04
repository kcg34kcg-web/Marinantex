import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchRagBackend, getRagBackendForLogs } from '@/app/api/rag/_lib/rag-backend';
import { createAdminClient } from '@/utils/supabase/admin';
import { createClient } from '@/utils/supabase/server';

export const runtime = 'nodejs';

const SOURCE_TYPES = ['legislation', 'case_law', 'article', 'internal_note'] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

const sourceTypeSchema = z.enum(SOURCE_TYPES);
const uuidSchema = z.string().uuid();
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

interface LawyerContext {
  userId: string;
  bureauId: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function pickErrorMessage(body: unknown): string {
  const bodyObj = asObject(body);
  if (!bodyObj) return 'Corpus ingest istegi basarisiz oldu.';
  if (typeof bodyObj.detail === 'string') return bodyObj.detail;
  if (typeof bodyObj.error === 'string') return bodyObj.error;
  if (typeof bodyObj.message === 'string') return bodyObj.message;
  const detailObj = asObject(bodyObj.detail);
  if (typeof detailObj?.message === 'string') return detailObj.message;
  return 'Corpus ingest istegi basarisiz oldu.';
}

function parseSourceTypeFromUrl(url: string | null): SourceType {
  if (!url) return 'article';
  const parts = url.split('/');
  const maybeType = parts.length > 3 ? parts[3] : '';
  return sourceTypeSchema.safeParse(maybeType).success
    ? (maybeType as SourceType)
    : 'article';
}

function parseAclTags(raw: string | null): string[] {
  const text = (raw ?? '').trim();
  if (!text) return ['public'];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const tags = parsed
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0)
        .slice(0, 16);
      if (tags.length > 0) return tags;
    }
  } catch {
    // no-op: fallback to CSV parser
  }
  const csvTags = text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 16);
  return csvTags.length > 0 ? csvTags : ['public'];
}

function parseIsoDate(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const candidate = raw.trim();
  if (!candidate) return undefined;
  return isoDateSchema.safeParse(candidate).success ? candidate : undefined;
}

function buildSourceId(sourceType: SourceType, sourceUrl: string, sourceTitle: string): string {
  const fromUrl = slugify(sourceUrl).slice(0, 96);
  if (fromUrl) {
    return `${sourceType}-${fromUrl}`.slice(0, 120);
  }
  const fallback = slugify(sourceTitle).slice(0, 64) || 'untitled';
  return `${sourceType}-${Date.now()}-${fallback}`.slice(0, 120);
}

async function requireLawyerContext(): Promise<LawyerContext | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Oturum bulunamadi.' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, bureau_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !profile?.bureau_id) {
    return NextResponse.json({ error: 'Buro baglami bulunamadi.' }, { status: 401 });
  }
  if (profile.role !== 'lawyer') {
    return NextResponse.json(
      { error: 'Corpus paneli yalnizca avukat rolune aciktir.' },
      { status: 403 },
    );
  }

  return {
    userId: user.id,
    bureauId: profile.bureau_id,
  };
}

async function extractTextFromFile(file: File): Promise<{ text: string; meta: Record<string, unknown> }> {
  const fileName = file.name.toLowerCase();
  const isPdf = file.type === 'application/pdf' || fileName.endsWith('.pdf');
  if (isPdf) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const module = await import('pdf-parse');
    const pdfParseFn =
      ((module as unknown as { default?: (data: Buffer) => Promise<{ text?: string; numpages?: number }> })
        .default
        ?? (module as unknown as (data: Buffer) => Promise<{ text?: string; numpages?: number }>));
    const parsed = await pdfParseFn(buffer);
    return {
      text: String(parsed?.text ?? '').trim(),
      meta: {
        parser: 'pdf-parse',
        pages: parsed?.numpages ?? null,
      },
    };
  }

  return {
    text: (await file.text()).trim(),
    meta: {
      parser: 'plain_text',
      pages: null,
    },
  };
}

export async function GET(request: Request) {
  const ctx = await requireLawyerContext();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 60), 1), 200);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('rag_documents')
    .select('id, title, source_type, source_id, metadata, created_at, updated_at')
    .eq('bureau_id', ctx.bureauId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: 'Corpus kayitlari okunamadi.', detail: error.message },
      { status: 500 },
    );
  }

  type RawDocRow = {
    id: string;
    title?: string | null;
    source_type?: string | null;
    source_id?: string | null;
    metadata?: unknown;
    created_at?: string | null;
    updated_at?: string | null;
  };

  const documentIds = ((data ?? []) as RawDocRow[])
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const chunkCountByDoc = new Map<string, number>();
  if (documentIds.length > 0) {
    const chunkResp = await admin
      .from('rag_chunks')
      .select('document_id')
      .in('document_id', documentIds);
    if (!chunkResp.error) {
      for (const row of (chunkResp.data ?? []) as Array<{ document_id?: string }>) {
        const docId = typeof row.document_id === 'string' ? row.document_id : null;
        if (!docId) continue;
        chunkCountByDoc.set(docId, (chunkCountByDoc.get(docId) ?? 0) + 1);
      }
    }
  }

  const grouped = new Map<
    string,
    {
      source_url: string | null;
      source_type: SourceType;
      citation: string | null;
      court_level: string | null;
      norm_hierarchy: string | null;
      case_id: string | null;
      segment_count: number;
      latest_created_at: string | null;
      first_collected_at: string | null;
      sample_doc_id: string;
    }
  >();

  for (const row of (data ?? []) as RawDocRow[]) {
    const metadata = asObject(row.metadata) ?? {};
    const sourceUrlRaw = typeof metadata.source_url === 'string'
      ? metadata.source_url
      : null;
    const sourceUrl = sourceUrlRaw || `ragv3://${row.source_type ?? 'article'}/${row.source_id ?? row.id}`;
    const sourceTypeRaw = typeof row.source_type === 'string' ? row.source_type : '';
    const sourceType = sourceTypeSchema.safeParse(sourceTypeRaw).success
      ? (sourceTypeRaw as SourceType)
      : parseSourceTypeFromUrl(sourceUrlRaw);
    const citation = typeof metadata.citation === 'string'
      ? metadata.citation
      : (row.title ?? null);
    const courtLevel = typeof metadata.court_level === 'string' ? metadata.court_level : null;
    const normHierarchy = typeof metadata.norm_hierarchy === 'string' ? metadata.norm_hierarchy : null;
    const caseId = typeof metadata.case_id === 'string' ? metadata.case_id : null;
    const segmentCount = chunkCountByDoc.get(row.id) ?? 0;
    const key = sourceUrl || row.id;
    const current = grouped.get(key);
    const rowCreatedAt = row.updated_at ?? row.created_at ?? null;

    if (!current) {
      grouped.set(key, {
        source_url: sourceUrl,
        source_type: sourceType,
        citation,
        court_level: courtLevel,
        norm_hierarchy: normHierarchy,
        case_id: caseId,
        segment_count: segmentCount,
        latest_created_at: rowCreatedAt,
        first_collected_at: row.created_at ?? null,
        sample_doc_id: row.id,
      });
      continue;
    }

    current.segment_count += segmentCount;
    if ((rowCreatedAt ?? '') > (current.latest_created_at ?? '')) {
      current.latest_created_at = rowCreatedAt;
    }
    if (!current.first_collected_at && row.created_at) {
      current.first_collected_at = row.created_at;
    }
  }

  let items = Array.from(grouped.values()).sort((a, b) =>
    (b.latest_created_at ?? '').localeCompare(a.latest_created_at ?? ''),
  );

  if (query) {
    items = items.filter((item) => {
      const haystack = `${item.source_url ?? ''} ${item.citation ?? ''} ${item.court_level ?? ''} ${item.norm_hierarchy ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  return NextResponse.json({
    ingestion_mode: 'rag_indexing',
    training_mode: 'no_fine_tuning',
    corpus_scope: 'bureau_internal',
    items: items.slice(0, limit),
  });
}

export async function POST(request: Request) {
  const ctx = await requireLawyerContext();
  if (ctx instanceof NextResponse) return ctx;

  const formData = await request.formData();
  const sourceTitle = String(formData.get('source_title') ?? '').trim();
  const sourceTypeRaw = String(formData.get('source_type') ?? '').trim();
  const sourceTypeParsed = sourceTypeSchema.safeParse(sourceTypeRaw);
  const sourceType: SourceType = sourceTypeParsed.success ? sourceTypeParsed.data : 'article';
  const citationInput = String(formData.get('citation') ?? '').trim();
  const normHierarchy = String(formData.get('norm_hierarchy') ?? '').trim();
  const courtLevel = String(formData.get('court_level') ?? '').trim();
  const caseIdInput = String(formData.get('case_id') ?? '').trim();
  const rawTextInput = String(formData.get('raw_text') ?? '').trim();
  const contentInput = String(formData.get('content') ?? '').trim();
  const sourceUrlInput = String(formData.get('source_url') ?? '').trim();
  const fileUrlInput = String(formData.get('file_url') ?? '').trim();
  const sourceIdInput = String(formData.get('source_id') ?? '').trim();
  const jurisdictionInput = String(formData.get('jurisdiction') ?? '').trim();
  const effectiveFromInput = String(formData.get('effective_from') ?? '').trim();
  const effectiveToInput = String(formData.get('effective_to') ?? '').trim();
  const aclTagsInput = String(formData.get('acl_tags') ?? '').trim();
  const fileEntry = formData.get('file');
  const file = fileEntry instanceof File ? fileEntry : null;

  if (!sourceTitle) {
    return NextResponse.json({ error: 'source_title zorunludur.' }, { status: 400 });
  }

  let caseId: string | undefined;
  if (caseIdInput) {
    const parsedCase = uuidSchema.safeParse(caseIdInput);
    if (!parsedCase.success) {
      return NextResponse.json({ error: 'case_id UUID formatinda olmalidir.' }, { status: 400 });
    }
    caseId = parsedCase.data;
  }

  let extractedText = rawTextInput || contentInput;
  let parseMeta: Record<string, unknown> = {
    parser: 'manual_text',
    file_name: null,
    pages: null,
  };

  if (!extractedText && file) {
    const parsed = await extractTextFromFile(file);
    extractedText = parsed.text;
    parseMeta = {
      ...parsed.meta,
      file_name: file.name,
    };
  }

  if (!extractedText) {
    return NextResponse.json(
      { error: 'raw_text veya file zorunludur (en az biri dolu olmali).' },
      { status: 400 },
    );
  }

  if (extractedText.length > 800_000) {
    return NextResponse.json(
      { error: 'Belge metni cok uzun. 800000 karakter sinirini asiyor.' },
      { status: 413 },
    );
  }

  const sourceSlug = slugify(sourceTitle).slice(0, 80) || 'untitled';
  const sourceUrl =
    sourceUrlInput
    || fileUrlInput
    || `admin://corpus/${sourceType}/${Date.now()}-${sourceSlug}`;
  const sourceId = sourceIdInput || buildSourceId(sourceType, sourceUrl, sourceTitle);
  const jurisdiction = jurisdictionInput || 'TR';
  const effectiveFrom = parseIsoDate(effectiveFromInput);
  const effectiveTo = parseIsoDate(effectiveToInput);
  const aclTags = parseAclTags(aclTagsInput);

  const citation = [sourceTitle, citationInput || null].filter(Boolean).join(' | ');
  let upstream: Response;
  try {
    upstream = await fetchRagBackend('/api/v1/rag-v3/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bureau-ID': ctx.bureauId,
        'X-User-ID': ctx.userId,
      },
      body: JSON.stringify({
        title: sourceTitle,
        source_type: sourceType,
        source_id: sourceId,
        raw_text: extractedText,
        source_format: 'text',
        jurisdiction,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        acl_tags: aclTags,
        metadata: {
          source_url: sourceUrl,
          file_url: sourceUrl,
          citation,
          norm_hierarchy: normHierarchy || null,
          court_level: courtLevel || null,
          case_id: caseId ?? null,
          parse_meta: parseMeta,
          ingest_channel: 'admin_corpus',
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    console.error('[Admin corpus proxy]', error, { backendCandidates: getRagBackendForLogs() });
    return NextResponse.json(
      { error: 'Corpus ingest servisine baglanilamadi.' },
      { status: 502 },
    );
  }

  let body: unknown = null;
  try {
    body = await upstream.json();
  } catch {
    body = null;
  }

  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: pickErrorMessage(body),
      },
      { status: upstream.status },
    );
  }

  const result = asObject(body) ?? {};
  const documentId = typeof result.document_id === 'string' ? result.document_id : null;
  const chunkCount = typeof result.chunk_count === 'number' ? result.chunk_count : 0;
  const chunkHashes = Array.isArray(result.chunk_hashes)
    ? result.chunk_hashes.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return NextResponse.json(
    {
      document_id: documentId,
      chunk_count: chunkCount,
      contract_version: typeof result.contract_version === 'string' ? result.contract_version : undefined,
      schema_version: typeof result.schema_version === 'string' ? result.schema_version : undefined,
      warnings: Array.isArray(result.warnings)
        ? result.warnings.filter((entry): entry is string => typeof entry === 'string')
        : [],
      ingestion_mode: 'rag_indexing',
      training_mode: 'no_fine_tuning',
      corpus_scope: 'bureau_internal',
      source_type: sourceType,
      source_url: sourceUrl,
      parse_meta: parseMeta,
      ingest_result: {
        doc_id: documentId,
        segments_created: chunkCount,
        citations_extracted: 0,
        embedding_generated: chunkCount > 0,
        enqueued_for_index: false,
        document_id: documentId,
        chunk_count: chunkCount,
        doc_hash: typeof result.doc_hash === 'string' ? result.doc_hash : null,
        chunk_hashes: chunkHashes,
        source_id: sourceId,
        contract_version: typeof result.contract_version === 'string' ? result.contract_version : null,
        schema_version: typeof result.schema_version === 'string' ? result.schema_version : null,
        warnings: Array.isArray(result.warnings)
          ? result.warnings.filter((entry): entry is string => typeof entry === 'string')
          : [],
      },
    },
    { status: 200 },
  );
}
