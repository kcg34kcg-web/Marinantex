import { NextResponse } from 'next/server';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { fetchRagBackend, getRagBackendForLogs } from '@/app/api/rag/_lib/rag-backend';
import { createClient } from '@/utils/supabase/server';

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function pickErrorMessage(body: unknown): string {
  const bodyObj = asObject(body);
  if (!bodyObj) return 'Observability verisi alinamadi.';

  const detail = bodyObj.detail;
  if (typeof detail === 'string') return detail;
  if (typeof bodyObj.error === 'string') return bodyObj.error;
  if (typeof bodyObj.message === 'string') return bodyObj.message;

  const detailObj = asObject(detail);
  if (typeof detailObj?.message === 'string') return detailObj.message;

  return 'Observability verisi alinamadi.';
}

function parseWindowHours(value: string | null): number {
  if (!value) return 24;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 24;
  return Math.max(1, Math.min(parsed, 24 * 30));
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    let context;
    try {
      context = await resolveBureauContext(supabase);
    } catch {
      return NextResponse.json({ error: 'Oturum bulunamadi. Lutfen tekrar giris yapin.' }, { status: 401 });
    }

    const { bureauId, userId } = context;
    if (!bureauId) {
      return NextResponse.json({ error: 'Buro baglami bulunamadi. Profilinizi kontrol edin.' }, { status: 401 });
    }

    const url = new URL(request.url);
    const windowHours = parseWindowHours(url.searchParams.get('window_hours'));

    const upstream = await fetchRagBackend(`/api/v1/rag/observability?window_hours=${windowHours}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Bureau-ID': bureauId,
        'X-User-ID': userId,
      },
      signal: AbortSignal.timeout(20_000),
    });

    let body: unknown = null;
    try {
      body = await upstream.json();
    } catch {
      body = null;
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { error: pickErrorMessage(body) },
        { status: upstream.status },
      );
    }

    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Observability istegi zaman asimina ugradi.'
        : 'Observability servisine baglanilamadi.';
    console.error('[RAG observability proxy]', err, { backendCandidates: getRagBackendForLogs() });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
