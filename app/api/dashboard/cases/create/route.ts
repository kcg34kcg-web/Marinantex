import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const createCaseSchema = z.object({
  title: z.string().min(3).max(180),
  status: z.enum(['open', 'in_progress', 'closed', 'archived']).default('open'),
  clientId: z.string().uuid().optional(),
  clientIds: z.array(z.string().uuid()).max(20).optional(),
  lawyerId: z.string().uuid().optional(),
  autoCode: z.boolean().default(false),
  caseCode: z.string().trim().max(50).nullable().optional(),
  fileNo: z.string().trim().max(64).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
  clientDetails: z
    .object({
      fullName: z.string().trim().max(120).optional(),
      tcIdentity: z.string().trim().max(32).optional(),
      contactName: z.string().trim().max(120).optional(),
      email: z.string().email().optional(),
      phone: z.string().trim().max(40).optional(),
      partyType: z.enum(['plaintiff', 'defendant', 'consultant']).optional(),
      fileNo: z.string().trim().max(64).optional(),
    })
    .optional(),
});

function generateCaseCode() {
  const year = new Date().getFullYear();
  const token = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `MRN-${year}-${token}`;
}

function uniqueIds(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export async function GET() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const admin = createAdminClient();

  const [clientsResult, lawyersResult] = await Promise.all([
    admin
      .from('clients')
      .select('id, full_name, email, file_no, public_ref_code')
      .is('deleted_at', null)
      .order('full_name', { ascending: true }),
    admin.from('profiles').select('id, full_name').in('role', ['lawyer', 'assistant']).order('full_name', { ascending: true }),
  ]);

  if (clientsResult.error?.code === '42P01') {
    const fallbackClients = await admin
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'client')
      .order('full_name', { ascending: true });

    if (fallbackClients.error || lawyersResult.error) {
      return Response.json({ error: 'Dosya form verileri alinamadi.' }, { status: 500 });
    }

    return Response.json({
      clients: (fallbackClients.data ?? []).map((item) => ({
        id: item.id,
        fullName: item.full_name,
        email: null,
        fileNo: null,
        publicRefCode: null,
      })),
      lawyers: (lawyersResult.data ?? []).map((item) => ({
        id: item.id,
        fullName: item.full_name,
      })),
    });
  }

  if (clientsResult.error || lawyersResult.error) {
    return Response.json({ error: 'Dosya form verileri alinamadi.' }, { status: 500 });
  }

  return Response.json({
    clients: (clientsResult.data ?? []).map((item) => ({
      id: item.id,
      fullName: item.full_name,
      email: item.email,
      fileNo: item.file_no,
      publicRefCode: item.public_ref_code,
    })),
    lawyers: (lawyersResult.data ?? []).map((item) => ({
      id: item.id,
      fullName: item.full_name,
    })),
  });
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = createCaseSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz dosya verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();
  let createdClientCandidate = false;

  const normalizedClientDetails = payload.clientDetails
    ? {
        fullName: payload.clientDetails.fullName?.trim() || null,
        tcIdentity: payload.clientDetails.tcIdentity?.trim() || null,
        contactName: payload.clientDetails.contactName?.trim() || null,
        email: payload.clientDetails.email?.trim().toLowerCase() || null,
        phone: payload.clientDetails.phone?.trim() || null,
        partyType: payload.clientDetails.partyType ?? null,
        fileNo: payload.clientDetails.fileNo?.trim() || null,
      }
    : null;

  let resolvedLawyerId = payload.lawyerId;

  if (!resolvedLawyerId) {
    if (access.role === 'lawyer') {
      resolvedLawyerId = access.userId;
    } else {
      const firstLawyer = await admin
        .from('profiles')
        .select('id')
        .eq('role', 'lawyer')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      resolvedLawyerId = firstLawyer.data?.id ?? access.userId;
    }
  }

  const lawyerCheck = await admin
    .from('profiles')
    .select('id')
    .eq('id', resolvedLawyerId)
    .in('role', ['lawyer', 'assistant'])
    .maybeSingle();

  if (lawyerCheck.error || !lawyerCheck.data) {
    return Response.json({ error: 'Seçilen avukat geçersiz.' }, { status: 400 });
  }

  const selectedClientIds = uniqueIds([
    ...(payload.clientIds ?? []),
    ...(payload.clientId ? [payload.clientId] : []),
  ]);

  const clientsTableProbe = await admin.from('clients').select('id').limit(1);
  const clientsTableAvailable = clientsTableProbe.error?.code !== '42P01';

  if (clientsTableAvailable && selectedClientIds.length > 0) {
    const linkedClients = await admin
      .from('clients')
      .select('id')
      .in('id', selectedClientIds)
      .is('deleted_at', null);

    if (linkedClients.error || (linkedClients.data ?? []).length !== selectedClientIds.length) {
      return Response.json({ error: 'Seçilen müvekkillerden en az biri geçersiz.' }, { status: 400 });
    }
  }

  const resolvedCaseCode = payload.autoCode ? generateCaseCode() : payload.caseCode ?? null;
  const normalizedTags = payload.tags
    .map((item) => item.trim())
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);

  const caseInsert = await admin
    .from('cases')
    .insert({
      title: payload.title,
      case_code: resolvedCaseCode,
      file_no: payload.fileNo?.trim() || null,
      tags: normalizedTags,
      client_display_name: selectedClientIds.length === 0 ? normalizedClientDetails?.fullName ?? null : null,
      status: payload.status,
      lawyer_id: resolvedLawyerId,
      client_id: payload.clientId ?? null,
      updated_at: new Date().toISOString(),
    })
    .select('id, title, case_code, file_no, tags, client_display_name, status, updated_at')
    .single();

  const caseInsertResult =
    caseInsert.error?.code === '42703'
      ? await admin
          .from('cases')
          .insert({
            title: payload.title,
            status: payload.status,
            lawyer_id: resolvedLawyerId,
            client_id: payload.clientId ?? null,
            updated_at: new Date().toISOString(),
          })
          .select('id, title, status, updated_at')
          .single()
      : caseInsert;

  const data = caseInsertResult.data as
    | {
        id: string;
        title: string;
        case_code?: string | null;
        file_no?: string | null;
        tags?: string[];
        client_display_name?: string | null;
        status: string;
        updated_at: string;
      }
    | null;
  const error = caseInsertResult.error;

  if (error || !data) {
    if (error?.code === '23505') {
      return Response.json({ error: 'Dosya kodu çakisti. Tekrar deneyin.' }, { status: 409 });
    }

    return Response.json({ error: 'Dosya olusturulamadi.' }, { status: 500 });
  }

  if (clientsTableAvailable && selectedClientIds.length > 0) {
    const relationRows = selectedClientIds.map((clientId) => ({
      case_id: data.id,
      client_id: clientId,
      created_by: access.userId,
    }));

    await admin.from('case_clients').upsert(relationRows, {
      onConflict: 'case_id,client_id',
      ignoreDuplicates: false,
    });
  }

  const hasClientDetailNote = Boolean(
    normalizedClientDetails &&
      (
        normalizedClientDetails.fullName ||
        normalizedClientDetails.tcIdentity ||
        normalizedClientDetails.contactName ||
        normalizedClientDetails.email ||
        normalizedClientDetails.phone ||
        normalizedClientDetails.partyType ||
        normalizedClientDetails.fileNo
      )
  );

  if (hasClientDetailNote) {
    const partyLabel =
      normalizedClientDetails?.partyType === 'plaintiff'
        ? 'Davaci'
        : normalizedClientDetails?.partyType === 'defendant'
          ? 'Davali'
          : normalizedClientDetails?.partyType === 'consultant'
            ? 'Danisan'
            : null;

    const detailLines = [
      'Müvekkil bilgi notu (opsiyonel formdan):',
      normalizedClientDetails?.fullName ? `- Ad Soyad: ${normalizedClientDetails.fullName}` : null,
      normalizedClientDetails?.tcIdentity ? `- TC/VKN: ${normalizedClientDetails.tcIdentity}` : null,
      normalizedClientDetails?.contactName ? `- Iletisim Kisisi: ${normalizedClientDetails.contactName}` : null,
      normalizedClientDetails?.email ? `- E-Posta: ${normalizedClientDetails.email}` : null,
      normalizedClientDetails?.phone ? `- Telefon: ${normalizedClientDetails.phone}` : null,
      normalizedClientDetails?.fileNo ? `- Dosya No: ${normalizedClientDetails.fileNo}` : null,
      partyLabel ? `- Taraf Tipi: ${partyLabel}` : null,
    ]
      .filter((item): item is string => Boolean(item))
      .join('\n');

    await admin.from('case_updates').insert({
      case_id: data.id,
      message: detailLines,
      is_public_to_client: false,
      created_by: access.userId,
    });

    const shouldCreateClientCandidate = clientsTableAvailable && selectedClientIds.length === 0 && Boolean(normalizedClientDetails?.fullName);

    if (shouldCreateClientCandidate) {
      const clientCandidate = await admin
        .from('clients')
        .insert({
          full_name: normalizedClientDetails?.fullName,
          email: normalizedClientDetails?.email,
          phone: normalizedClientDetails?.phone,
          tc_identity: normalizedClientDetails?.tcIdentity,
          party_type: normalizedClientDetails?.partyType,
          file_no: normalizedClientDetails?.fileNo,
          status: normalizedClientDetails?.email ? 'invited' : 'active',
          created_by: access.userId,
        })
        .select('id, email')
        .single();

      if (!clientCandidate.error && clientCandidate.data) {
        createdClientCandidate = true;

        await admin.from('case_clients').upsert(
          {
            case_id: data.id,
            client_id: clientCandidate.data.id,
            created_by: access.userId,
          },
          {
            onConflict: 'case_id,client_id',
          }
        );

        if (clientCandidate.data.email) {
          const token = `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

          const inviteInsert = await admin
            .from('user_invites')
            .insert({
              email: clientCandidate.data.email,
              full_name: normalizedClientDetails?.fullName,
              username: null,
              tc_identity: normalizedClientDetails?.tcIdentity,
              contact_name: normalizedClientDetails?.contactName,
              phone: normalizedClientDetails?.phone,
              party_type: normalizedClientDetails?.partyType,
              target_role: 'client',
              token,
              invited_by: access.userId,
              invited_client_id: clientCandidate.data.id,
              expires_at: expiresAt,
            })
            .select('id')
            .single();

          if (!inviteInsert.error && inviteInsert.data) {
            await admin
              .from('clients')
              .update({ source_invite_id: inviteInsert.data.id })
              .eq('id', clientCandidate.data.id);
          }
        }
      }
    }
  }

  await admin.from('case_timeline_events').insert({
    case_id: data.id,
    event_type: 'status_change',
    title: 'Dosya olusturuldu',
    description: `Durum: ${data.status}`,
    metadata: {
      status: data.status,
      caseCode: data.case_code ?? null,
      fileNo: data.file_no ?? payload.fileNo ?? null,
    },
    created_by: access.userId,
  });

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'case_created',
    entityType: 'case',
    entityId: data.id,
    metadata: {
      status: data.status,
      clientCount: selectedClientIds.length,
      fileNo: data.file_no ?? payload.fileNo ?? null,
      createdClientCandidate,
    },
  });

  return Response.json({
    case: {
      id: data.id,
      title: data.title,
      caseCode: data.case_code ?? null,
      fileNo: data.file_no ?? payload.fileNo ?? null,
      tags: data.tags ?? [],
      status: data.status,
      updatedAt: data.updated_at,
    },
    clientCandidateCreated: createdClientCandidate,
  });
}

