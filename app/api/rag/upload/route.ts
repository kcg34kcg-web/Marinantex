import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { fetchRagBackend, getRagBackendForLogs } from '@/app/api/rag/_lib/rag-backend';
import { createClient } from '@/utils/supabase/server';

export const runtime = 'nodejs';

const uploadSchema = z.object({
  file_name: z.string().min(1).max(260),
  raw_text: z.string().min(1).max(600_000),
  content: z.string().max(600_000).optional(),
  case_id: z.string().uuid().optional(),
  source_url: z.string().max(500).optional(),
  file_url: z.string().max(500).optional(),
  citation: z.string().max(500).optional(),
  source_type: z.string().min(1).max(120).optional(),
  source_id: z.string().min(1).max(120).optional(),
  jurisdiction: z.string().min(2).max(10).optional(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  acl_tags: z.array(z.string().min(1).max(64)).max(16).optional(),
});

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function pickErrorMessage(body: unknown): string {
  const bodyObj = asObject(body);
  if (!bodyObj) return 'Belge ingest istegi basarisiz oldu.';
  if (typeof bodyObj.detail === 'string') return bodyObj.detail;
  if (typeof bodyObj.error === 'string') return bodyObj.error;
  if (typeof bodyObj.message === 'string') return bodyObj.message;
  const detailObj = asObject(bodyObj.detail);
  if (typeof detailObj?.message === 'string') return detailObj.message;
  return 'Belge ingest istegi basarisiz oldu.';
}

function buildUploadSourceUrl(fileName: string, userId: string): string {
  const safeFile = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `upload://${userId.slice(0, 8)}/${Date.now()}-${safeFile || 'document.txt'}`;
}

function buildUploadSourceId(fileName: string, userId: string): string {
  const safeFile = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `upload-${userId.slice(0, 8)}-${Date.now()}-${safeFile || 'document'}`.slice(0, 120);
}

function parseAclTags(raw: string | null | undefined): string[] {
  const text = (raw ?? '').trim();
  if (!text) return ['public'];
  const asJson = (() => {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item).trim())
          .filter((item) => item.length > 0)
          .slice(0, 16);
      }
      return null;
    } catch {
      return null;
    }
  })();
  if (asJson && asJson.length > 0) return asJson;
  const csv = text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 16);
  return csv.length > 0 ? csv : ['public'];
}

function isPdfFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type === 'application/pdf' || name.endsWith('.pdf');
}

function isWordLikeFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === 'application/msword'
    || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || name.endsWith('.doc')
    || name.endsWith('.docx')
  );
}

async function extractTextFromUploadFile(file: File): Promise<string> {
  if (isPdfFile(file)) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const module = await import('pdf-parse');
    const pdfParseFn =
      ((module as unknown as { default?: (data: Buffer) => Promise<{ text?: string }> }).default
      ?? (module as unknown as (data: Buffer) => Promise<{ text?: string }>));
    return String((await pdfParseFn(buffer))?.text ?? '').trim();
  }

  const plainText = (await file.text())
    .replace(/\u0000/g, ' ')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (isWordLikeFile(file) && plainText.length < 24) {
    throw new Error('Word dosyasindan metin cikarilamadi. Lutfen PDF veya metin tabanli format deneyin.');
  }

  return plainText;
}

async function parseUploadInput(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const fileEntry = formData.get('file');
    const file = fileEntry instanceof File ? fileEntry : null;

    const rawTextInput = String(formData.get('raw_text') ?? '').trim();
    const contentInput = String(formData.get('content') ?? '').trim();
    let rawText = rawTextInput || contentInput;
    let fileName = String(formData.get('file_name') ?? '').trim();
    const aclTags = parseAclTags(String(formData.get('acl_tags') ?? '').trim());

    if (!rawText && file) {
      rawText = await extractTextFromUploadFile(file);
      fileName = fileName || file.name;
    }

    const payload = {
      file_name: fileName,
      raw_text: rawText,
      content: contentInput || undefined,
      case_id: String(formData.get('case_id') ?? '').trim() || undefined,
      source_url: String(formData.get('source_url') ?? '').trim() || undefined,
      file_url: String(formData.get('file_url') ?? '').trim() || undefined,
      citation: String(formData.get('citation') ?? '').trim() || undefined,
      source_type: String(formData.get('source_type') ?? '').trim() || undefined,
      source_id: String(formData.get('source_id') ?? '').trim() || undefined,
      jurisdiction: String(formData.get('jurisdiction') ?? '').trim() || undefined,
      effective_from: String(formData.get('effective_from') ?? '').trim() || undefined,
      effective_to: String(formData.get('effective_to') ?? '').trim() || undefined,
      acl_tags: aclTags,
    };

    return uploadSchema.safeParse(payload);
  }

  const body = asObject(await request.json()) ?? {};
  const rawTextInput = typeof body.raw_text === 'string' ? body.raw_text.trim() : '';
  const contentInput = typeof body.content === 'string' ? body.content.trim() : '';
  const aclTags = Array.isArray(body.acl_tags)
    ? body.acl_tags
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0)
      .slice(0, 16)
    : parseAclTags(typeof body.acl_tags === 'string' ? body.acl_tags : '');

  return uploadSchema.safeParse({
    file_name: typeof body.file_name === 'string' ? body.file_name.trim() : '',
    raw_text: rawTextInput || contentInput,
    content: contentInput || undefined,
    case_id: typeof body.case_id === 'string' ? body.case_id.trim() : undefined,
    source_url: typeof body.source_url === 'string' ? body.source_url.trim() : undefined,
    file_url: typeof body.file_url === 'string' ? body.file_url.trim() : undefined,
    citation: typeof body.citation === 'string' ? body.citation.trim() : undefined,
    source_type: typeof body.source_type === 'string' ? body.source_type.trim() : undefined,
    source_id: typeof body.source_id === 'string' ? body.source_id.trim() : undefined,
    jurisdiction: typeof body.jurisdiction === 'string' ? body.jurisdiction.trim() : undefined,
    effective_from: typeof body.effective_from === 'string' ? body.effective_from.trim() : undefined,
    effective_to: typeof body.effective_to === 'string' ? body.effective_to.trim() : undefined,
    acl_tags: aclTags,
  });
}

export async function POST(request: Request) {
  try {
    const parsed = await parseUploadInput(request);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => issue.message).join(' ') },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    let context;
    try {
      context = await resolveBureauContext(supabase);
    } catch {
      return NextResponse.json({ error: 'Oturum bulunamadi.' }, { status: 401 });
    }

    const { bureauId, userId } = context;
    if (!bureauId) {
      return NextResponse.json({ error: 'Buro baglami bulunamadi.' }, { status: 401 });
    }

    const sourceUrl =
      parsed.data.source_url?.trim()
      || parsed.data.file_url?.trim()
      || buildUploadSourceUrl(parsed.data.file_name, userId);
    const citation = parsed.data.citation?.trim() || `Yuklenen belge: ${parsed.data.file_name}`;
    const sourceType = parsed.data.source_type?.trim() || 'uploaded_document';
    const sourceId = parsed.data.source_id?.trim() || buildUploadSourceId(parsed.data.file_name, userId);
    const aclTags = parsed.data.acl_tags && parsed.data.acl_tags.length > 0
      ? parsed.data.acl_tags
      : ['public'];
    const upstream = await fetchRagBackend('/api/v1/rag-v3/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bureau-ID': bureauId,
        'X-User-ID': userId,
      },
      body: JSON.stringify({
        title: parsed.data.file_name,
        source_type: sourceType,
        source_id: sourceId,
        raw_text: parsed.data.raw_text,
        source_format: 'text',
        jurisdiction: parsed.data.jurisdiction ?? 'TR',
        effective_from: parsed.data.effective_from,
        effective_to: parsed.data.effective_to,
        acl_tags: aclTags,
        metadata: {
          source_url: sourceUrl,
          file_url: sourceUrl,
          citation,
          case_id: parsed.data.case_id ?? null,
          file_name: parsed.data.file_name,
          ingest_channel: 'ui_upload',
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    let body: unknown = null;
    try {
      body = await upstream.json();
    } catch {
      body = null;
    }

    if (!upstream.ok) {
      return NextResponse.json({ error: pickErrorMessage(body) }, { status: upstream.status });
    }

    const bodyObj = asObject(body) ?? {};
    const docId = typeof bodyObj.document_id === 'string' ? bodyObj.document_id : '';
    const chunkCount = typeof bodyObj.chunk_count === 'number' ? bodyObj.chunk_count : 0;
    const chunkHashes = Array.isArray(bodyObj.chunk_hashes)
      ? bodyObj.chunk_hashes.filter((item): item is string => typeof item === 'string')
      : [];
    if (!docId) {
      return NextResponse.json({ error: 'Ingest yaniti gecersiz: doc_id yok.' }, { status: 503 });
    }
    const warnings = Array.isArray(bodyObj.warnings)
      ? bodyObj.warnings.filter((item): item is string => typeof item === 'string')
      : [];
    return NextResponse.json(
      {
        document_id: docId,
        chunk_count: chunkCount,
        contract_version: typeof bodyObj.contract_version === 'string' ? bodyObj.contract_version : undefined,
        schema_version: typeof bodyObj.schema_version === 'string' ? bodyObj.schema_version : undefined,
        warnings,
        doc_id: docId,
        segments_created: chunkCount,
        citations_extracted: 0,
        embedding_generated: chunkCount > 0,
        enqueued_for_index: false,
        doc_hash: typeof bodyObj.doc_hash === 'string' ? bodyObj.doc_hash : '',
        chunk_hashes: chunkHashes,
        source_id: sourceId,
        source_type: sourceType,
        file_name: parsed.data.file_name,
        ingest_contract_version: typeof bodyObj.contract_version === 'string' ? bodyObj.contract_version : undefined,
        ingest_schema_version: typeof bodyObj.schema_version === 'string' ? bodyObj.schema_version : undefined,
      },
      { status: 200 },
    );
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Belge ingest istegi zaman asimina ugradi. Lutfen tekrar deneyin.'
        : 'Belge upload servisine baglanilamadi.';
    console.error('[RAG upload proxy]', err, { backendCandidates: getRagBackendForLogs() });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
