import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const { id: clientId } = await context.params;
  const admin = createAdminClient();

  const linksResult = await admin
    .from('case_clients')
    .select('id, case_id, public_ref_code, relation_note, created_at')
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (linksResult.error?.code === '42P01') {
    const clientProfileResult = await admin
      .from('clients')
      .select('profile_id')
      .eq('id', clientId)
      .is('deleted_at', null)
      .maybeSingle<{ profile_id: string | null }>();

    const profileId = clientProfileResult.data?.profile_id ?? null;
    if (!profileId) {
      return Response.json({ items: [] });
    }

    const legacyCases = await admin
      .from('cases')
      .select('id, title, status, file_no, updated_at')
      .eq('client_id', profileId)
      .order('updated_at', { ascending: false });

    if (legacyCases.error) {
      return Response.json({ error: 'Dosya bilgileri alinamadi.' }, { status: 500 });
    }

    return Response.json({
      items: (legacyCases.data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        fileNo: row.file_no,
        updatedAt: row.updated_at,
        publicRefCode: null,
        relationNote: null,
        linkedAt: row.updated_at,
      })),
    });
  }

  if (linksResult.error) {
    return Response.json({ error: 'Müvekkil dosyalari alinamadi.' }, { status: 500 });
  }

  const links = linksResult.data ?? [];
  const caseIds = [...new Set(links.map((item) => item.case_id))];

  const casesResult = caseIds.length
    ? await admin
        .from('cases')
        .select('id, title, status, file_no, updated_at')
        .in('id', caseIds)
    : { data: [], error: null };

  if (casesResult.error) {
    return Response.json({ error: 'Dosya bilgileri alinamadi.' }, { status: 500 });
  }

  const caseById = new Map((casesResult.data ?? []).map((item) => [item.id, item]));

  return Response.json({
    items: links
      .map((item) => {
        const row = caseById.get(item.case_id);
        if (!row) {
          return null;
        }

        return {
          id: row.id,
          title: row.title,
          status: row.status,
          fileNo: row.file_no,
          updatedAt: row.updated_at,
          publicRefCode: item.public_ref_code,
          relationNote: item.relation_note,
          linkedAt: item.created_at,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
  });
}

