import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { ragProxyErrorResponse } from '@/app/api/rag/_lib/error-contract';
import { fetchRagBackend, getRagBackendForLogs } from '@/app/api/rag/_lib/rag-backend';
import { enforceRagRouteRateLimit } from '@/app/api/rag/_lib/rate-limit';
import { isTimeoutError } from '@/app/api/rag/_lib/timeout';
import { createClient } from '@/utils/supabase/server';

const assignSchema = z.object({
  reviewer_id: z.string().uuid(),
  sla_minutes: z.number().int().min(1).max(7 * 24 * 60).optional(),
  due_at: z.string().datetime().optional(),
  escalation_reason: z.string().max(400).optional(),
});

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function pickErrorMessage(body: unknown): string {
  const bodyObj = asObject(body);
  if (!bodyObj) return 'RAG v3 review assign istegi basarisiz oldu.';
  if (typeof bodyObj.detail === 'string') return bodyObj.detail;
  if (typeof bodyObj.error === 'string') return bodyObj.error;
  if (typeof bodyObj.message === 'string') return bodyObj.message;
  const detailObj = asObject(bodyObj.detail);
  if (typeof detailObj?.message === 'string') return detailObj.message;
  return 'RAG v3 review assign istegi basarisiz oldu.';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ ticketId: string }> },
) {
  try {
    const { ticketId: rawTicketId } = await context.params;
    const ticketId = String(rawTicketId ?? '').trim();
    if (!ticketId) {
      return ragProxyErrorResponse({
        status: 400,
        errorCode: 'INVALID_REQUEST',
        message: 'ticketId zorunludur.',
      });
    }

    const parsed = assignSchema.safeParse(await request.json());
    if (!parsed.success) {
      return ragProxyErrorResponse({
        status: 400,
        errorCode: 'INVALID_REQUEST',
        message: parsed.error.issues.map((issue) => issue.message).join(' '),
      });
    }

    const supabase = await createClient();
    let tenant;
    try {
      tenant = await resolveBureauContext(supabase, {
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

    const { bureauId, userId, accessLevel, accessToken } = tenant;
    if (!bureauId) {
      return ragProxyErrorResponse({
        status: 401,
        errorCode: 'BUREAU_CONTEXT_MISSING',
        message: 'Buro baglami bulunamadi. Lutfen tekrar giris yapin.',
      });
    }
    const rateLimit = await enforceRagRouteRateLimit({
      request,
      routeKey: 'v3_review_assign',
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

    const upstream = await fetchRagBackend(`/api/v1/rag-v3/review-queue/${encodeURIComponent(ticketId)}/assign`, {
      method: 'POST',
      headers,
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(60_000),
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
      ? 'RAG v3 review assign istegi zaman asimina ugradi.'
      : 'RAG v3 review assign servisine baglanilamadi.';
    console.error('[RAG v3 review assign proxy]', err, { backendCandidates: getRagBackendForLogs() });
    return ragProxyErrorResponse({
      status: 502,
      errorCode: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      message,
      retryable: true,
    });
  }
}
