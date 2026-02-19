/**
 * /api/rag  —  Next.js proxy to the Babylexit FastAPI RAG backend.
 *
 * POST /api/rag
 *   Forwards the request to POST /api/v1/rag/query on the Python backend.
 *   Keeps the API key / bureau-id out of the browser.
 *
 * Env:
 *   RAG_BACKEND_URL   – base URL of the FastAPI service (default: http://localhost:8000)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

const requestSchema = z.object({
  query: z.string().min(1, 'Sorgu boş olamaz.').max(2000, 'Sorgu çok uzun.'),
  case_id: z.string().uuid().optional(),
  event_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-AA-GG formatı gerekli.')
    .optional(),
  decision_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-AA-GG formatı gerekli.')
    .optional(),
  top_k: z.number().int().min(1).max(20).optional(),
});

export type RagQueryPayload = z.infer<typeof requestSchema>;

export async function POST(req: Request) {
  try {
    const parsed = requestSchema.safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(' ') }, { status: 400 });
    }

    const backendUrl = process.env.RAG_BACKEND_URL ?? 'http://localhost:8000';

    const upstream = await fetch(`${backendUrl}/api/v1/rag/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      // 90 s timeout – Tier 4 multi-agent can take up to 90 s
      signal: AbortSignal.timeout(95_000),
    });

    const body = await upstream.json();

    if (!upstream.ok) {
      return NextResponse.json({ error: body?.detail ?? 'Backend hatası oluştu.' }, { status: upstream.status });
    }

    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'İstek zaman aşımına uğradı. Lütfen tekrar deneyin.'
        : 'Sunucu bağlantı hatası.';
    console.error('[RAG proxy]', err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
