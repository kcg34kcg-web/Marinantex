import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { canAccessCase } from '@/lib/dashboard/access';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const querySchema = z.object({
  caseId: z.string().uuid(),
});

const regenerateSchema = z.object({
  caseId: z.string().uuid(),
});

function summarizeText(input: string, maxLen = 1200): string {
  const cleaned = input.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLen - 3)}...`;
}

export async function GET(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = querySchema.safeParse({
    caseId: new URL(request.url).searchParams.get('caseId'),
  });

  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz caseId.' }, { status: 400 });
  }

  const caseId = parsed.data.caseId;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyanin AI özetine erisim yetkiniz yok.' }, { status: 403 });
  }

  const summaryResult = await admin
    .from('ai_case_summaries')
    .select('id, summary_text, status, source_snapshot, last_generated_at, updated_at')
    .eq('case_id', caseId)
    .maybeSingle();

  if (summaryResult.error) {
    return Response.json({ error: 'AI dosya özeti alinamadi.' }, { status: 500 });
  }

  if (!summaryResult.data) {
    return Response.json({
      summary: {
        id: null,
        status: 'placeholder',
        summaryText: 'Henüz özet olusturulmadi. "Özeti Yeniden Olustur" butonu ile baslatabilirsiniz.',
        sourceSnapshot: {},
        lastGeneratedAt: null,
        updatedAt: null,
      },
    });
  }

  return Response.json({
    summary: {
      id: summaryResult.data.id,
      status: summaryResult.data.status,
      summaryText: summaryResult.data.summary_text,
      sourceSnapshot: summaryResult.data.source_snapshot,
      lastGeneratedAt: summaryResult.data.last_generated_at,
      updatedAt: summaryResult.data.updated_at,
    },
  });
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = regenerateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz AI özet verisi.' }, { status: 400 });
  }

  const caseId = parsed.data.caseId;
  const admin = createAdminClient();

  const allowed = await canAccessCase(admin, {
    caseId,
    userId: access.userId,
    role: access.role,
  });

  if (!allowed) {
    return Response.json({ error: 'Bu dosyada AI özet olusturma yetkiniz yok.' }, { status: 403 });
  }

  const [caseRow, timelineRows, documentRows] = await Promise.all([
    admin
      .from('cases')
      .select('id, title, status, overview_notes, updated_at')
      .eq('id', caseId)
      .maybeSingle(),
    admin
      .from('case_timeline_events')
      .select('event_type, title, description, created_at')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20),
    admin
      .from('case_documents')
      .select('id, file_name, mime_type, created_at')
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  if (caseRow.error || !caseRow.data) {
    return Response.json({ error: 'Dosya bulunamadi.' }, { status: 404 });
  }

  const timeline = timelineRows.data ?? [];
  const documents = documentRows.data ?? [];

  const generatedSummary = summarizeText(
    [
      `Dosya: ${caseRow.data.title}`,
      `Durum: ${caseRow.data.status}`,
      caseRow.data.overview_notes ? `Genel Bakis Notu: ${caseRow.data.overview_notes}` : '',
      `Belge Sayisi: ${documents.length}`,
      documents.length
        ? `Son Belgeler: ${documents
            .slice(0, 5)
            .map((item) => item.file_name)
            .join(', ')}`
        : 'Belge kaydi yok.',
      `Timeline Event Sayisi: ${timeline.length}`,
      timeline.length
        ? `Son Olaylar: ${timeline
            .slice(0, 6)
            .map((item) => `${item.event_type} - ${item.title}`)
            .join(' | ')}`
        : 'Timeline kaydi yok.',
      'Not: Bu özet placeholder mantigiyla üretilmistir. Ileri asamada LLM servisi ile zenginlestirilecektir.',
    ]
      .filter(Boolean)
      .join('\n')
  );

  const now = new Date().toISOString();

  const upsertResult = await admin.from('ai_case_summaries').upsert(
    {
      case_id: caseId,
      summary_text: generatedSummary,
      status: 'ready',
      source_snapshot: {
        caseUpdatedAt: caseRow.data.updated_at,
        documentCount: documents.length,
        timelineCount: timeline.length,
      },
      last_generated_at: now,
      generated_by: access.userId,
      updated_at: now,
    },
    {
      onConflict: 'case_id',
      ignoreDuplicates: false,
    }
  ).select('id, summary_text, status, source_snapshot, last_generated_at, updated_at').single();

  if (upsertResult.error || !upsertResult.data) {
    return Response.json({ error: 'AI dosya özeti olusturulamadi.' }, { status: 500 });
  }

  await admin.from('case_timeline_events').insert({
    case_id: caseId,
    event_type: 'user_action',
    title: 'AI dosya özeti güncellendi',
    description: 'Özet yeniden olusturuldu.',
    metadata: {
      summaryId: upsertResult.data.id,
    },
    created_by: access.userId,
  });

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'ai_case_summary_regenerated',
    entityType: 'ai_case_summary',
    entityId: upsertResult.data.id,
    metadata: {
      caseId,
    },
  });

  return Response.json({
    summary: {
      id: upsertResult.data.id,
      status: upsertResult.data.status,
      summaryText: upsertResult.data.summary_text,
      sourceSnapshot: upsertResult.data.source_snapshot,
      lastGeneratedAt: upsertResult.data.last_generated_at,
      updatedAt: upsertResult.data.updated_at,
    },
  });
}

