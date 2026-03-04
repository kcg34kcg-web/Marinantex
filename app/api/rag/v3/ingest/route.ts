import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { fetchRagBackend, getRagBackendForLogs } from '@/app/api/rag/_lib/rag-backend';
import { createClient } from '@/utils/supabase/server';

const ingestSchema = z.object({
  title: z.string().min(1).max(500),
  source_type: z.string().min(1).max(120),
  source_id: z.string().min(1).max(120),
  raw_text: z.string().min(1).max(2_000_000),
  source_format: z.enum(['text', 'pdf', 'html']).optional(),
  jurisdiction: z.string().min(2).max(10).optional(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  acl_tags: z.array(z.string().min(1).max(64)).max(16).optional(),
  metadata: z.record(z.any()).optional(),
});

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function pickErrorMessage(body: unknown): string {
  const bodyObj = asObject(body);
  if (!bodyObj) return 'RAG v3 ingest istegi basarisiz oldu.';
  if (typeof bodyObj.detail === 'string') return bodyObj.detail;
  if (typeof bodyObj.error === 'string') return bodyObj.error;
  if (typeof bodyObj.message === 'string') return bodyObj.message;
  const detailObj = asObject(bodyObj.detail);
  if (typeof detailObj?.message === 'string') return detailObj.message;
  return 'RAG v3 ingest istegi basarisiz oldu.';
}

export async function POST(request: Request) {
  try {
    const parsed = ingestSchema.safeParse(await request.json());
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
    const upstream = await fetchRagBackend('/api/v1/rag-v3/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bureau-ID': bureauId || userId,
        'X-User-ID': userId,
      },
      body: JSON.stringify({
        title: parsed.data.title,
        source_type: parsed.data.source_type,
        source_id: parsed.data.source_id,
        raw_text: parsed.data.raw_text,
        source_format: parsed.data.source_format ?? 'text',
        jurisdiction: parsed.data.jurisdiction ?? 'TR',
        effective_from: parsed.data.effective_from,
        effective_to: parsed.data.effective_to,
        acl_tags: parsed.data.acl_tags ?? ['public'],
        metadata: parsed.data.metadata ?? {},
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

    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'RAG v3 ingest istegi zaman asimina ugradi.'
        : 'RAG v3 ingest servisine baglanilamadi.';
    console.error('[RAG v3 ingest proxy]', err, { backendCandidates: getRagBackendForLogs() });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
