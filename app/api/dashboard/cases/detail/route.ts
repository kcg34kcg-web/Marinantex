import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { canAccessCase } from '@/lib/dashboard/access';

const detailQuerySchema = z.object({
  caseId: z.string().uuid(),
});

export async function GET(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = detailQuerySchema.safeParse({
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
    return Response.json({ error: 'Bu dosyayi görüntüleme yetkiniz yok.' }, { status: 403 });
  }

  const caseResult = await admin
    .from('cases')
    .select('id, title, status, file_no, case_code, tags, overview_notes, overview_notes_updated_at, updated_at, created_at')
    .eq('id', caseId)
    .maybeSingle();

  if (caseResult.error || !caseResult.data) {
    return Response.json({ error: 'Dosya bulunamadi.' }, { status: 404 });
  }

  const [caseClientsResult, aiSummaryResult] = await Promise.all([
    admin
      .from('case_clients')
      .select('id, case_id, client_id, public_ref_code, relation_note, created_at')
      .eq('case_id', caseId)
      .is('deleted_at', null),
    admin
      .from('ai_case_summaries')
      .select('id, summary_text, status, last_generated_at, updated_at')
      .eq('case_id', caseId)
      .maybeSingle(),
  ]);

  const clientLinks = caseClientsResult.error ? [] : (caseClientsResult.data ?? []);
  const clientIds = [...new Set(clientLinks.map((item) => item.client_id))];

  const clientsResult = clientIds.length
    ? await admin
        .from('clients')
        .select('id, full_name, email, file_no, public_ref_code')
        .in('id', clientIds)
        .is('deleted_at', null)
    : { data: [], error: null };

  const clientsById = new Map(
    ((clientsResult.data ?? []) as Array<{ id: string; full_name: string; email: string | null; file_no: string | null; public_ref_code: string }>).map((item) => [
      item.id,
      {
        id: item.id,
        fullName: item.full_name,
        email: item.email,
        fileNo: item.file_no,
        publicRefCode: item.public_ref_code,
      },
    ])
  );

  const linkedClients = clientLinks
    .map((item) => {
      const client = clientsById.get(item.client_id);
      if (!client) {
        return null;
      }

      return {
        ...client,
        relationId: item.id,
        relationPublicRefCode: item.public_ref_code,
        relationNote: item.relation_note,
        linkedAt: item.created_at,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return Response.json({
    case: {
      id: caseResult.data.id,
      title: caseResult.data.title,
      status: caseResult.data.status,
      fileNo: caseResult.data.file_no,
      caseCode: caseResult.data.case_code,
      tags: caseResult.data.tags ?? [],
      overviewNotes: caseResult.data.overview_notes ?? '',
      overviewNotesUpdatedAt: caseResult.data.overview_notes_updated_at,
      updatedAt: caseResult.data.updated_at,
      createdAt: caseResult.data.created_at,
      linkedClients,
    },
    aiSummary: aiSummaryResult.error
      ? null
      : aiSummaryResult.data
        ? {
            id: aiSummaryResult.data.id,
            summaryText: aiSummaryResult.data.summary_text,
            status: aiSummaryResult.data.status,
            lastGeneratedAt: aiSummaryResult.data.last_generated_at,
            updatedAt: aiSummaryResult.data.updated_at,
          }
        : null,
  });
}

