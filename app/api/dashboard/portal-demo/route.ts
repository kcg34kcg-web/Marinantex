import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { seedPortalDemoDataset } from '@/lib/portal/demo-seed';
import { detectHearingScheduledAt, isHearingLike } from '@/lib/portal/hearing-calendar';

const querySchema = z.object({
  autoSeed: z.enum(['0', '1']).default('1'),
});

interface CaseRow {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'closed' | 'archived';
  file_no: string | null;
  updated_at: string;
}

export async function GET(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsedQuery = querySchema.safeParse({
    autoSeed: new URL(request.url).searchParams.get('autoSeed') ?? '1',
  });
  if (!parsedQuery.success) {
    return Response.json({ error: 'Geçersiz demo sorgusu.' }, { status: 400 });
  }

  if (parsedQuery.data.autoSeed === '1') {
    await seedPortalDemoDataset({
      preferredLawyerId: access.userId,
      preferredTenantId: access.bureauId,
    }).catch(() => undefined);
  }

  const admin = createAdminClient();
  const casesResult = await admin
    .from('cases')
    .select('id, title, status, file_no, updated_at')
    .eq('bureau_id', access.bureauId)
    .ilike('title', 'Demo Portal Dosyası - %')
    .order('updated_at', { ascending: false })
    .limit(20);

  if (casesResult.error) {
    return Response.json({ error: 'Demo dosya listesi alınamadı.' }, { status: 500 });
  }

  const rows = (casesResult.data ?? []) as CaseRow[];
  const caseIds = rows.map((item) => item.id);

  const [updatesResult, docsResult, messagesResult, hearingsResult] = await Promise.all([
    caseIds.length
      ? admin
          .from('case_updates')
          .select('id, case_id, message, date')
          .in('case_id', caseIds)
          .order('date', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    caseIds.length
      ? admin
          .from('case_documents')
          .select('id, case_id, file_name, created_at')
          .in('case_id', caseIds)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    caseIds.length
      ? admin
          .from('portal_case_messages')
          .select('id, case_id, body, created_at')
          .in('case_id', caseIds)
          .order('created_at', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    caseIds.length
      ? admin
          .from('case_timeline_events')
          .select('id, case_id, event_type, title, description, metadata, created_at')
          .in('case_id', caseIds)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const updatesByCaseId = new Map<string, { message: string; date: string }>();
  (updatesResult.data ?? []).forEach((item) => {
    if (!updatesByCaseId.has(item.case_id)) {
      updatesByCaseId.set(item.case_id, {
        message: item.message,
        date: item.date,
      });
    }
  });

  const documentsByCaseId = new Map<string, { fileName: string; createdAt: string }>();
  (docsResult.data ?? []).forEach((item) => {
    if (!documentsByCaseId.has(item.case_id)) {
      documentsByCaseId.set(item.case_id, {
        fileName: item.file_name,
        createdAt: item.created_at,
      });
    }
  });

  const messagesByCaseId = new Map<string, { body: string; createdAt: string }>();
  (messagesResult.data ?? []).forEach((item) => {
    if (!messagesByCaseId.has(item.case_id)) {
      messagesByCaseId.set(item.case_id, {
        body: item.body,
        createdAt: item.created_at,
      });
    }
  });

  const hearingsByCaseId = new Map<string, { title: string; scheduledAt: string }>();
  (hearingsResult.data ?? []).forEach((item) => {
    if (hearingsByCaseId.has(item.case_id)) return;
    if (
      !isHearingLike({
        eventType: item.event_type,
        title: item.title,
        metadata: item.metadata,
      })
    ) {
      return;
    }
    const scheduledAt = detectHearingScheduledAt(item.metadata) ?? item.created_at;
    hearingsByCaseId.set(item.case_id, {
      title: item.title,
      scheduledAt,
    });
  });

  return Response.json({
    items: rows.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      fileNo: item.file_no,
      updatedAt: item.updated_at,
      latestPublicUpdate: updatesByCaseId.get(item.id) ?? null,
      latestDocument: documentsByCaseId.get(item.id) ?? null,
      latestMessage: messagesByCaseId.get(item.id) ?? null,
      upcomingHearing: hearingsByCaseId.get(item.id) ?? null,
      openInPortalHref: `/portal/cases/${item.id}`,
    })),
  });
}

export async function POST() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const seeded = await seedPortalDemoDataset({
    preferredLawyerId: access.userId,
    preferredTenantId: access.bureauId,
  });

  return Response.json({
    success: true,
    seeded,
  });
}

