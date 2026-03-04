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

  const clientResult = await admin
    .from('clients')
    .select('id, full_name, email, phone, tc_identity, party_type, file_no, public_ref_code, status, profile_id, created_at, updated_at')
    .eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle();

  if (clientResult.error || !clientResult.data) {
    return Response.json({ error: 'Müvekkil bulunamadi.' }, { status: 404 });
  }

  const caseLinksResult = await admin
    .from('case_clients')
    .select('case_id')
    .eq('client_id', clientId)
    .is('deleted_at', null);

  if (caseLinksResult.error) {
    return Response.json({ error: 'Müvekkil dosya baglantilari alinamadi.' }, { status: 500 });
  }

  const caseIds = [...new Set((caseLinksResult.data ?? []).map((item) => item.case_id))];
  const linkedCasesResult = caseIds.length
    ? await admin
        .from('cases')
        .select('id, title, status, file_no, updated_at')
        .in('id', caseIds)
        .order('updated_at', { ascending: false })
    : { data: [], error: null };

  if (linkedCasesResult.error) {
    return Response.json({ error: 'Bagli dosyalar alinamadi.' }, { status: 500 });
  }

  return Response.json({
    client: {
      id: clientResult.data.id,
      fullName: clientResult.data.full_name,
      email: clientResult.data.email,
      phone: clientResult.data.phone,
      tcIdentity: clientResult.data.tc_identity,
      partyType: clientResult.data.party_type,
      fileNo: clientResult.data.file_no,
      publicRefCode: clientResult.data.public_ref_code,
      status: clientResult.data.status,
      profileId: clientResult.data.profile_id,
      createdAt: clientResult.data.created_at,
      updatedAt: clientResult.data.updated_at,
    },
    linkedCases: (linkedCasesResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      fileNo: item.file_no,
      updatedAt: item.updated_at,
    })),
  });
}

