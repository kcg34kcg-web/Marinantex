import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveLegalModelWithFallback } from '@/lib/ai/model-provider';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { canAccessCase } from '@/lib/dashboard/access';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const taskTypeSchema = z.enum([
  'follow_up',
  'petition_drafting',
  'contract_review',
  'precedent_research',
  'hearing_preparation',
  'client_meeting',
  'service_tracking',
  'uyap_control',
]);

const deadlineTypeSchema = z.enum([
  'due_date',
  'objection_deadline',
  'response_deadline',
  'hearing_date',
  'service_control',
]);

const suggestTaskSchema = z.object({
  caseId: z.string().uuid().optional(),
  title: z.string().min(3).max(180),
  description: z.string().max(4000).optional(),
  taskType: taskTypeSchema.optional(),
  deadlineType: deadlineTypeSchema.optional(),
  dueAt: z.string().datetime().optional(),
});

const taskAssistResponseSchema = z.object({
  subtasks: z.array(z.string().min(2).max(220)).min(2).max(8),
  missingFields: z.array(z.string().min(2).max(220)).max(6),
  reminderSuggestion: z.string().min(3).max(300),
  templateSuggestion: z.string().min(3).max(600),
  suggestedPriority: z.enum(['low', 'normal', 'high']),
  suggestedRiskLevel: z.enum(['low', 'medium', 'critical']),
  suggestedDeadlineType: deadlineTypeSchema,
});

type SuggestTaskInput = z.infer<typeof suggestTaskSchema>;

function normalizeList(items: string[], fallback: string[]): string[] {
  const clean = [...new Set(items.map((item) => item.trim()).filter(Boolean))];
  if (clean.length === 0) {
    return fallback;
  }
  return clean.slice(0, 8);
}

function buildHeuristicSuggestion(input: SuggestTaskInput) {
  const merged = `${input.title} ${input.description ?? ''}`.toLowerCase();
  const isPetition = merged.includes('dilekçe');
  const isHearing = merged.includes('duruşma');
  const isContract = merged.includes('sözleşme');

  const baseSubtasks = [
    'Dosya geçmişini ve mevcut evrakları kontrol et',
    'Eksik bilgi veya belge listesini çıkar',
    'Taslak metni hazırla ve iç kontrol yap',
  ];

  if (isPetition) {
    baseSubtasks.push('Emsal karar ve mevzuat dayanaklarını listele');
  }

  if (isHearing) {
    baseSubtasks.push('Duruşma için beyan ve soru setini hazırla');
  }

  if (isContract) {
    baseSubtasks.push('Riskli maddeler için revizyon önerisi oluştur');
  }

  const missingFields: string[] = [];
  if (!input.dueAt) {
    missingFields.push('Yasal son tarih/termin bilgisi girilmemiş.');
  }
  if (!input.description) {
    missingFields.push('Görev açıklaması kısa; kapsamı netleştirin.');
  }

  return {
    subtasks: normalizeList(baseSubtasks, ['Görev adımlarını manuel olarak detaylandırın.']),
    missingFields: normalizeList(missingFields, []),
    reminderSuggestion: input.dueAt
      ? 'Son tarihten 48 saat ve 6 saat önce hatırlatma önerilir.'
      : 'Son tarih girildiğinde çoklu hatırlatma planı oluşturun.',
    templateSuggestion: isPetition
      ? 'Dilekçe şablonu + delil listesi ile başlatın.'
      : isContract
        ? 'Sözleşme risk matrisi şablonu ile başlayın.'
        : 'Standart görev şablonu + kontrol listesi kullanın.',
    suggestedPriority: input.dueAt ? 'high' : 'normal',
    suggestedRiskLevel: input.dueAt ? 'critical' : 'medium',
    suggestedDeadlineType: input.deadlineType ?? 'due_date',
  };
}

function buildPrompt(input: SuggestTaskInput, caseContext?: { title: string; status: string; fileNo: string | null; overview: string }) {
  return [
    'Aşağıdaki hukuk görevi için ofis içi uygulanabilir görev önerisi üret.',
    'Yanıt sadece şema alanları ile sınırlı olmalı.',
    'Alt görevler kısa, eylem odaklı ve sıralı olmalı.',
    'Eksik alanlar gerçek anlamda eksik olan bilgilere dayanmalı.',
    '',
    `Görev başlığı: ${input.title}`,
    `Görev açıklaması: ${input.description ?? 'Yok'}`,
    `Görev tipi: ${input.taskType ?? 'follow_up'}`,
    `Yasal tarih tipi: ${input.deadlineType ?? 'due_date'}`,
    `Son tarih: ${input.dueAt ?? 'Yok'}`,
    caseContext ? `Dosya başlığı: ${caseContext.title}` : 'Dosya başlığı: Bilinmiyor',
    caseContext ? `Dosya durumu: ${caseContext.status}` : 'Dosya durumu: Bilinmiyor',
    caseContext ? `Dosya no: ${caseContext.fileNo ?? 'Yok'}` : 'Dosya no: Bilinmiyor',
    caseContext ? `Dosya özeti: ${caseContext.overview || 'Yok'}` : 'Dosya özeti: Bilinmiyor',
  ].join('\n');
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = suggestTaskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz AI görev öneri verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  let caseContext: { title: string; status: string; fileNo: string | null; overview: string } | undefined;
  if (payload.caseId) {
    const allowed = await canAccessCase(admin, {
      caseId: payload.caseId,
      userId: access.userId,
      role: access.role,
    });

    if (!allowed) {
      return Response.json({ error: 'Bu dosyada AI görev önerisi oluşturma yetkiniz yok.' }, { status: 403 });
    }

    const caseResult = await admin
      .from('cases')
      .select('title, status, file_no, overview_notes')
      .eq('id', payload.caseId)
      .maybeSingle();

    if (caseResult.error) {
      return Response.json({ error: 'Dosya bilgisi alınamadı.' }, { status: 500 });
    }

    if (!caseResult.data) {
      return Response.json({ error: 'Dosya bulunamadı.' }, { status: 404 });
    }

    caseContext = {
      title: caseResult.data.title,
      status: caseResult.data.status,
      fileNo: caseResult.data.file_no,
      overview: (caseResult.data.overview_notes ?? '').slice(0, 1200),
    };
  }

  try {
    const modelSelection = await resolveLegalModelWithFallback('summary');
    const result = await generateObject({
      model: modelSelection.model,
      schema: taskAssistResponseSchema,
      prompt: buildPrompt(payload, caseContext),
      temperature: 0.2,
    });

    const suggestion = {
      ...result.object,
      subtasks: normalizeList(result.object.subtasks, ['Görev adımları AI tarafından üretilemedi.']),
      missingFields: normalizeList(result.object.missingFields, []),
      model: {
        provider: modelSelection.providerName,
        id: modelSelection.modelId,
      },
    };

    await logDashboardAudit(admin, {
      actorUserId: access.userId,
      action: 'case_task_ai_assist_requested',
      entityType: 'office_task',
      entityId: null,
      metadata: {
        caseId: payload.caseId ?? null,
        taskType: payload.taskType ?? 'follow_up',
        modelProvider: modelSelection.providerName,
        modelId: modelSelection.modelId,
      },
    });

    return Response.json({ suggestion });
  } catch {
    const fallback = buildHeuristicSuggestion(payload);

    await logDashboardAudit(admin, {
      actorUserId: access.userId,
      action: 'case_task_ai_assist_fallback',
      entityType: 'office_task',
      entityId: null,
      metadata: {
        caseId: payload.caseId ?? null,
        taskType: payload.taskType ?? 'follow_up',
      },
    });

    return Response.json({
      suggestion: {
        ...fallback,
        model: {
          provider: 'heuristic',
          id: 'local-rule-engine',
        },
      },
    });
  }
}
