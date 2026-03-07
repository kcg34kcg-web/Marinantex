import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { ragProxyErrorResponse } from '@/app/api/rag/_lib/error-contract';
import { fetchRagBackend, getRagBackendForLogs } from '@/app/api/rag/_lib/rag-backend';
import { enforceRagRouteRateLimit } from '@/app/api/rag/_lib/rate-limit';
import { createClient } from '@/utils/supabase/server';

const deleteSchema = z
  .object({
    document_id: z.string().min(1).max(120).optional(),
    source_id: z.string().min(1).max(120).optional(),
    purge_raw_storage: z.boolean().optional(),
  })
  .superRefine((payload, ctx) => {
    const hasDocumentId = typeof payload.document_id === 'string' && payload.document_id.trim().length > 0;
    const hasSourceId = typeof payload.source_id === 'string' && payload.source_id.trim().length > 0;
    if (hasDocumentId === hasSourceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tam olarak bir alan verilmeli: document_id veya source_id.',
        path: ['document_id'],
      });
    }
  });

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function pickErrorMessage(body: unknown): string {
  const bodyObj = asObject(body);
  if (!bodyObj) return 'RAG v3 delete istegi basarisiz oldu.';
  if (typeof bodyObj.detail === 'string') return bodyObj.detail;
  if (typeof bodyObj.error === 'string') return bodyObj.error;
  if (typeof bodyObj.message === 'string') return bodyObj.message;
  const detailObj = asObject(bodyObj.detail);
  if (typeof detailObj?.message === 'string') return detailObj.message;
  return 'RAG v3 delete istegi basarisiz oldu.';
}

export async function POST(request: Request) {
  try {
    const parsed = deleteSchema.safeParse(await request.json());
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
    const rateLimit = enforceRagRouteRateLimit({
      request,
      routeKey: 'v3_delete',
      userId,
    });
    if (rateLimit.limited && rateLimit.response) {
      return rateLimit.response;
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Bureau-ID': bureauId,
      'X-User-ID': userId,
      'X-Access-Level': accessLevel,
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const upstream = await fetchRagBackend('/api/v1/rag-v3/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        document_id: parsed.data.document_id,
        source_id: parsed.data.source_id,
        purge_raw_storage: parsed.data.purge_raw_storage ?? false,
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
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'RAG v3 delete istegi zaman asimina ugradi.'
        : 'RAG v3 delete servisine baglanilamadi.';
    console.error('[RAG v3 delete proxy]', err, { backendCandidates: getRagBackendForLogs() });
    return ragProxyErrorResponse({
      status: 502,
      errorCode: err instanceof Error && err.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      message,
      retryable: true,
    });
  }
}
