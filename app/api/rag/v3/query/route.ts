import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { fetchRagBackend, getRagBackendForLogs } from '@/app/api/rag/_lib/rag-backend';
import { createClient } from '@/utils/supabase/server';

const querySchema = z.object({
  query: z.string().min(1).max(4000),
  top_k: z.number().int().min(8).max(12).optional(),
  jurisdiction: z.string().min(2).max(10).optional(),
  as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  requested_tier: z.number().int().min(1).max(4).optional(),
  acl_tags: z.array(z.string().min(1).max(64)).max(16).optional(),
});

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function pickErrorMessage(body: unknown): string {
  const bodyObj = asObject(body);
  if (!bodyObj) return 'RAG v3 query istegi basarisiz oldu.';
  if (typeof bodyObj.detail === 'string') return bodyObj.detail;
  if (typeof bodyObj.error === 'string') return bodyObj.error;
  if (typeof bodyObj.message === 'string') return bodyObj.message;
  const detailObj = asObject(bodyObj.detail);
  if (typeof detailObj?.message === 'string') return detailObj.message;
  return 'RAG v3 query istegi basarisiz oldu.';
}

export async function POST(request: Request) {
  try {
    const parsed = querySchema.safeParse(await request.json());
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
    const upstream = await fetchRagBackend('/api/v1/rag-v3/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bureau-ID': bureauId || userId,
        'X-User-ID': userId,
      },
      body: JSON.stringify({
        query: parsed.data.query,
        top_k: parsed.data.top_k ?? 10,
        jurisdiction: parsed.data.jurisdiction ?? 'TR',
        as_of_date: parsed.data.as_of_date,
        requested_tier: parsed.data.requested_tier ?? 2,
        acl_tags: parsed.data.acl_tags ?? ['public'],
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
        ? 'RAG v3 query istegi zaman asimina ugradi.'
        : 'RAG v3 query servisine baglanilamadi.';
    console.error('[RAG v3 query proxy]', err, { backendCandidates: getRagBackendForLogs() });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
