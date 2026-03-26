import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { ragProxyErrorResponse } from '@/app/api/rag/_lib/error-contract';
import { fetchRagBackend, getRagBackendForLogs } from '@/app/api/rag/_lib/rag-backend';
import { enforceRagRouteRateLimit } from '@/app/api/rag/_lib/rate-limit';
import { isTimeoutError } from '@/app/api/rag/_lib/timeout';
import { createClient } from '@/utils/supabase/server';

const ingestSchema = z.object({
  title: z.string().min(1).max(500),
  source_type: z.string().min(1).max(120),
  source_id: z.string().min(1).max(120),
  raw_text: z.string().min(1).max(2_000_000),
  source_format: z.enum(['text', 'pdf', 'html', 'docx', 'xml', 'json']).optional(),
  classification: z.enum(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SENSITIVE']).optional(),
  jurisdiction: z.string().min(2).max(10).optional(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  acl_tags: z.array(z.string().min(1).max(64)).max(16).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
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

function aclTagsForClassification(classification: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'SENSITIVE'): string[] {
  if (classification === 'PUBLIC') return ['public'];
  if (classification === 'INTERNAL') return ['internal'];
  if (classification === 'CONFIDENTIAL') return ['confidential'];
  return ['sensitive'];
}

export async function POST(request: Request) {
  try {
    const parsed = ingestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return ragProxyErrorResponse({
        status: 400,
        errorCode: 'INVALID_REQUEST',
        message: parsed.error.issues.map((issue) => issue.message).join(' '),
      });
    }

    const supabase = await createClient();
    let context;
    try {
      context = await resolveBureauContext(supabase, {
        requireClaimMatch: true,
        requireBureau: true,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      if (reason === 'TENANT_CLAIM_MISMATCH') {
        return ragProxyErrorResponse({
          status: 403,
          errorCode: 'TENANT_CLAIM_MISMATCH',
          message: 'Oturum tenant bilgisi ile profil tenant bilgisi uyusmuyor. Lutfen tekrar giris yapin.',
        });
      }
      if (reason === 'BUREAU_CONTEXT_MISSING') {
        return ragProxyErrorResponse({
          status: 401,
          errorCode: 'BUREAU_CONTEXT_MISSING',
          message: 'Buro baglami bulunamadi. Lutfen tekrar giris yapin.',
        });
      }
      return ragProxyErrorResponse({
        status: 401,
        errorCode: 'AUTH_REQUIRED',
        message: 'Oturum bulunamadi.',
      });
    }

    const { bureauId, userId, accessLevel, accessToken } = context;
    if (!bureauId) {
      return ragProxyErrorResponse({
        status: 401,
        errorCode: 'BUREAU_CONTEXT_MISSING',
        message: 'Buro baglami bulunamadi. Lutfen tekrar giris yapin.',
      });
    }
    const rateLimit = await enforceRagRouteRateLimit({
      request,
      routeKey: 'v3_ingest',
      userId,
    });
    if (rateLimit.limited && rateLimit.response) {
      return rateLimit.response;
    }
    const classification = parsed.data.classification ?? 'INTERNAL';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Bureau-ID': bureauId,
      'X-User-ID': userId,
      'X-Access-Level': accessLevel,
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const upstream = await fetchRagBackend('/api/v1/rag-v3/ingest', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: parsed.data.title,
        source_type: parsed.data.source_type,
        source_id: parsed.data.source_id,
        raw_text: parsed.data.raw_text,
        source_format: parsed.data.source_format ?? 'text',
        classification,
        jurisdiction: parsed.data.jurisdiction ?? 'TR',
        effective_from: parsed.data.effective_from,
        effective_to: parsed.data.effective_to,
        acl_tags: parsed.data.acl_tags ?? aclTagsForClassification(classification),
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
      return ragProxyErrorResponse({
        status: upstream.status,
        errorCode: 'RAG_BACKEND_ERROR',
        message: pickErrorMessage(body),
        retryable: upstream.status >= 500,
      });
    }

    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    const timedOut = isTimeoutError(err);
    const message = timedOut
      ? 'RAG v3 ingest istegi zaman asimina ugradi.'
      : 'RAG v3 ingest servisine baglanilamadi.';
    console.error('[RAG v3 ingest proxy]', err, { backendCandidates: getRagBackendForLogs() });
    return ragProxyErrorResponse({
      status: 502,
      errorCode: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      message,
      retryable: true,
    });
  }
}
