import { createHash, randomUUID } from 'node:crypto';
import { generateText } from 'ai';
import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { hasRedFlag } from '@/lib/ai/red-flag';
import { resolveLegalModelWithFallback } from '@/lib/ai/model-provider';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { requirePortalClientAccess, resolvePortalCaseAccess } from '@/lib/portal/access';

const requestSchema = z.object({
  caseId: z.string().uuid(),
  documentId: z.string().uuid().optional(),
  sourceText: z.string().max(30_000).optional(),
  mode: z.enum(['summary', 'simplify']).default('summary'),
});

const responseSchema = z.object({
  bullet_points: z.array(z.string().min(1)).min(1).max(10),
  key_facts: z.array(z.string().min(1)).min(1).max(10),
  risks: z.array(z.string().min(1)).min(1).max(10),
  outcome_explanation: z.string().min(1).max(2000),
  confidence_score: z.number().min(0).max(1),
});

function sanitizeInput(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12_000);
}

function hashPrompt(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function parseStructuredSummary(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;

  try {
    const parsed = JSON.parse(candidate);
    const validated = responseSchema.safeParse(parsed);
    if (validated.success) {
      return validated.data;
    }
  } catch {
    // Fall through to heuristic fallback.
  }

  const sentenceParts = candidate
    .replace(/\r/g, ' ')
    .split(/[.!?]\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const bulletPoints = sentenceParts.slice(0, 3);
  const keyFacts = sentenceParts.slice(0, 3);
  const risks = sentenceParts
    .filter((item) => /(risk|riski|belirsizlik|tehlike|olasılık|dikkat)/i.test(item))
    .slice(0, 3);

  return {
    bullet_points: bulletPoints.length > 0 ? bulletPoints : ['Özet üretildi ancak yapılandırılmış çıktı alınamadı.'],
    key_facts: keyFacts.length > 0 ? keyFacts : ['Temel olgular model çıktısından türetildi.'],
    risks: risks.length > 0 ? risks : ['Model güven skoru orta seviyede değerlendirildi.'],
    outcome_explanation: sentenceParts.slice(0, 2).join('. ') || candidate.slice(0, 600),
    confidence_score: 0.55,
  };
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz AI özet isteği.' }, { status: 400 });
  }

  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const context = access.context;
  const allowedCase = await resolvePortalCaseAccess({
    caseId: parsed.data.caseId,
    clientId: context.clientId,
    profileUserId: context.userId,
    bureauId: context.bureauId,
  });

  if (!allowedCase) {
    return Response.json({ error: 'Bu dosyada AI özeti isteme yetkiniz yok.' }, { status: 403 });
  }

  const admin = createAdminClient();
  let sourceText = parsed.data.sourceText?.trim() ?? '';

  if (!sourceText && parsed.data.documentId) {
    const documentResult = await admin
      .from('case_documents')
      .select('id, content_base64')
      .eq('id', parsed.data.documentId)
      .eq('case_id', parsed.data.caseId)
      .is('deleted_at', null)
      .maybeSingle();

    if (documentResult.error || !documentResult.data) {
      return Response.json({ error: 'Belge bulunamadı.' }, { status: 404 });
    }

    sourceText = documentResult.data.content_base64
      ? Buffer.from(documentResult.data.content_base64, 'base64').toString('utf8')
      : '';
  }

  sourceText = sanitizeInput(sourceText);
  if (!sourceText) {
    return Response.json({ error: 'Özetlenecek metin bulunamadı.' }, { status: 400 });
  }

  if (hasRedFlag(sourceText)) {
    return Response.json(
      {
        error: 'Kritik içerik tespit edildi. Bu metin için avukat onayı gerekir.',
        blocked: true,
      },
      { status: 409 }
    );
  }

  const aiRequestId = randomUUID();
  const createdAtIso = new Date().toISOString();
  const baseAiRequestPayload = {
    id: aiRequestId,
    tenant_id: context.bureauId,
    user_id: context.userId,
    case_id: parsed.data.caseId,
    document_id: parsed.data.documentId ?? null,
    request_type: parsed.data.mode,
    provider: 'pending',
    model: 'pending',
    prompt_hash: hashPrompt(`${parsed.data.mode}:${sourceText}`),
    status: 'processing',
    prompt_injection_detected: false,
    pii_detected: false,
    disclaimer_shown: true,
    no_retention_mode: true,
    metadata: {
      source: parsed.data.documentId ? 'document' : 'direct_text',
    },
    created_at: createdAtIso,
  };

  const aiInsert = await admin.from('ai_requests').insert(baseAiRequestPayload);
  const aiRequestsTableAvailable = !aiInsert.error || aiInsert.error.code !== '42P01';
  if (aiInsert.error && aiInsert.error.code !== '42P01') {
    return Response.json({ error: 'AI kayıt altyapısı kullanılamıyor.' }, { status: 500 });
  }

  try {
    const modelSelection = await resolveLegalModelWithFallback('summary');
    const prompt = [
      'Aşağıdaki hukuki içeriği müvekkil için sade şekilde özetle.',
      'Kesin hukuki tavsiye verme.',
      'Sonucu kesin gerçek gibi sunma.',
      'Sadece JSON döndür.',
      'JSON şeması:',
      '{"bullet_points": string[], "key_facts": string[], "risks": string[], "outcome_explanation": string, "confidence_score": number}',
      `Mod: ${parsed.data.mode}`,
      `İçerik: ${sourceText}`,
    ].join('\n');

    const generation = await generateText({
      model: modelSelection.model,
      temperature: 0.2,
      prompt,
    });

    const structured = parseStructuredSummary(generation.text);
    const completedAtIso = new Date().toISOString();

    if (aiRequestsTableAvailable) {
      await admin
        .from('ai_requests')
        .update({
          provider: modelSelection.providerName,
          model: modelSelection.modelId,
          status: 'completed',
          confidence_score: structured.confidence_score,
          completed_at: completedAtIso,
          metadata: {
            ...baseAiRequestPayload.metadata,
            sourceLength: sourceText.length,
            fallbackUsed: false,
          },
        })
        .eq('id', aiRequestId);
    }

    await writePortalAuditEvent({
      tenantId: context.bureauId,
      actorUserId: context.userId,
      eventType: 'portal_ai_summary_requested',
      objectType: 'ai_request',
      objectId: aiRequestId,
      ipAddress: extractRequestIp(request),
      userAgent: request.headers.get('user-agent'),
      result: 'success',
      metadata: {
        caseId: parsed.data.caseId,
        documentId: parsed.data.documentId ?? null,
        mode: parsed.data.mode,
        confidenceScore: structured.confidence_score,
      },
    }).catch(() => undefined);

    return Response.json({
      requestId: aiRequestId,
      summary: {
        bulletPoints: structured.bullet_points,
        keyFacts: structured.key_facts,
        risks: structured.risks,
        outcomeExplanation: structured.outcome_explanation,
        confidenceScore: structured.confidence_score,
        disclaimer: 'This summary is for informational purposes only.',
      },
    });
  } catch {
    if (aiRequestsTableAvailable) {
      await admin
        .from('ai_requests')
        .update({
          status: 'failed',
          error_code: 'GENERATION_FAILED',
          completed_at: new Date().toISOString(),
        })
        .eq('id', aiRequestId);
    }

    await writePortalAuditEvent({
      tenantId: context.bureauId,
      actorUserId: context.userId,
      eventType: 'portal_ai_summary_requested',
      objectType: 'ai_request',
      objectId: aiRequestId,
      ipAddress: extractRequestIp(request),
      userAgent: request.headers.get('user-agent'),
      result: 'error',
      reasonCode: 'GENERATION_FAILED',
      metadata: {
        caseId: parsed.data.caseId,
        documentId: parsed.data.documentId ?? null,
        mode: parsed.data.mode,
      },
    }).catch(() => undefined);

    return Response.json({ error: 'AI özet üretimi başarısız oldu.' }, { status: 500 });
  }
}
