import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';

const createCaseSchema = z.object({
  title: z.string().min(3).max(180),
  status: z.enum(['open', 'in_progress', 'closed', 'archived']).default('open'),
  clientId: z.string().uuid().optional(),
  lawyerId: z.string().uuid().optional(),
  autoCode: z.boolean().default(false),
  caseCode: z.string().trim().max(50).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
  clientDetails: z
    .object({
      fullName: z.string().trim().max(120).optional(),
      tcIdentity: z.string().trim().max(32).optional(),
      contactName: z.string().trim().max(120).optional(),
      email: z.string().email().optional(),
      phone: z.string().trim().max(40).optional(),
      partyType: z.enum(['plaintiff', 'defendant', 'consultant']).optional(),
    })
    .optional(),
});

function generateCaseCode() {
  const year = new Date().getFullYear();
  const token = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `MRN-${year}-${token}`;
}

export async function GET() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const supabase = access.supabase;

  const [clientsResult, lawyersResult] = await Promise.all([
    supabase.from('profiles').select('id, full_name').eq('role', 'client').order('full_name', { ascending: true }),
    supabase.from('profiles').select('id, full_name').eq('role', 'lawyer').order('full_name', { ascending: true }),
  ]);

  if (clientsResult.error || lawyersResult.error) {
    return Response.json({ error: 'Dosya form verileri alınamadı.' }, { status: 500 });
  }

  return Response.json({
    clients: (clientsResult.data ?? []).map((item) => ({
      id: item.id,
      fullName: item.full_name,
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
  const supabase = access.supabase;
  let createdClientCandidate = false;

  const normalizedClientDetails = payload.clientDetails
    ? {
        fullName: payload.clientDetails.fullName?.trim() || null,
        tcIdentity: payload.clientDetails.tcIdentity?.trim() || null,
        contactName: payload.clientDetails.contactName?.trim() || null,
        email: payload.clientDetails.email?.trim().toLowerCase() || null,
        phone: payload.clientDetails.phone?.trim() || null,
        partyType: payload.clientDetails.partyType ?? null,
      }
    : null;

  let resolvedLawyerId = payload.lawyerId;

  if (!resolvedLawyerId) {
    if (access.role === 'lawyer') {
      resolvedLawyerId = access.userId;
    } else {
      const { data: firstLawyer, error: lawyerError } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'lawyer')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (lawyerError || !firstLawyer) {
        resolvedLawyerId = access.userId;
      } else {
        resolvedLawyerId = firstLawyer.id;
      }
    }
  }

  const checks = await Promise.all([
    supabase.from('profiles').select('id').eq('id', resolvedLawyerId).in('role', ['lawyer', 'assistant']).maybeSingle(),
    payload.clientId
      ? supabase.from('profiles').select('id').eq('id', payload.clientId).eq('role', 'client').maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const lawyerCheck = checks[0];
  const clientCheck = checks[1];

  if (lawyerCheck.error || !lawyerCheck.data) {
    return Response.json({ error: 'Seçilen avukat geçersiz.' }, { status: 400 });
  }

  if (payload.clientId && (clientCheck.error || !clientCheck.data)) {
    return Response.json({ error: 'Seçilen müvekkil geçersiz.' }, { status: 400 });
  }

  const resolvedCaseCode = payload.autoCode ? generateCaseCode() : payload.caseCode ?? null;
  const normalizedTags = payload.tags
    .map((item) => item.trim())
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);

  const primaryInsert = await supabase
    .from('cases')
    .insert({
      title: payload.title,
      case_code: resolvedCaseCode,
      tags: normalizedTags,
      client_display_name: payload.clientId ? null : normalizedClientDetails?.fullName ?? null,
      status: payload.status,
      lawyer_id: resolvedLawyerId,
      client_id: payload.clientId ?? null,
      updated_at: new Date().toISOString(),
    })
    .select('id, title, case_code, tags, client_display_name, status, updated_at')
    .single();

  const insertResult =
    primaryInsert.error?.code === '42703'
      ? await supabase
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
      : primaryInsert;

  const data = insertResult.data as
    | {
        id: string;
        title: string;
        case_code?: string | null;
        tags?: string[];
        client_display_name?: string | null;
        status: string;
        updated_at: string;
      }
    | null;
  const error = insertResult.error;

  if (error || !data) {
    if (error?.code === '23505') {
      return Response.json({ error: 'Dosya kodu çakıştı. Tekrar deneyin.' }, { status: 409 });
    }

    return Response.json({ error: 'Dosya oluşturulamadı.' }, { status: 500 });
  }

  const hasClientDetailNote = Boolean(
    normalizedClientDetails &&
      (
        normalizedClientDetails.fullName ||
        normalizedClientDetails.tcIdentity ||
        normalizedClientDetails.contactName ||
        normalizedClientDetails.email ||
        normalizedClientDetails.phone ||
        normalizedClientDetails.partyType
      )
  );

  if (hasClientDetailNote) {
    const partyLabel =
      normalizedClientDetails?.partyType === 'plaintiff'
        ? 'Davacı'
        : normalizedClientDetails?.partyType === 'defendant'
          ? 'Davalı'
          : normalizedClientDetails?.partyType === 'consultant'
            ? 'Danışan'
            : null;

    const detailLines = [
      'Müvekkil Bilgi Notu (opsiyonel formdan):',
      normalizedClientDetails?.fullName ? `- Ad Soyad: ${normalizedClientDetails.fullName}` : null,
      normalizedClientDetails?.tcIdentity ? `- TC/VKN: ${normalizedClientDetails.tcIdentity}` : null,
      normalizedClientDetails?.contactName ? `- İletişim Kişisi: ${normalizedClientDetails.contactName}` : null,
      normalizedClientDetails?.email ? `- E-Posta: ${normalizedClientDetails.email}` : null,
      normalizedClientDetails?.phone ? `- Telefon: ${normalizedClientDetails.phone}` : null,
      partyLabel ? `- Taraf Tipi: ${partyLabel}` : null,
    ]
      .filter((item): item is string => Boolean(item))
      .join('\n');

    await supabase.from('case_updates').insert({
      case_id: data.id,
      message: detailLines,
      is_public_to_client: false,
      created_by: access.userId,
    });

    const shouldCreateClientCandidate = !payload.clientId && Boolean(normalizedClientDetails?.email);

    if (shouldCreateClientCandidate) {
      const token = `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const primaryInviteInsert = await supabase
        .from('user_invites')
        .insert({
          email: normalizedClientDetails?.email,
          full_name: normalizedClientDetails?.fullName,
          username: null,
          tc_identity: normalizedClientDetails?.tcIdentity,
          contact_name: normalizedClientDetails?.contactName,
          phone: normalizedClientDetails?.phone,
          party_type: normalizedClientDetails?.partyType,
          target_role: 'client',
          token,
          invited_by: access.userId,
          expires_at: expiresAt,
        })
        .select('id')
        .single();

      const inviteInsertResult =
        primaryInviteInsert.error?.code === '42703'
          ? await supabase
              .from('user_invites')
              .insert({
                email: normalizedClientDetails?.email,
                target_role: 'client',
                token,
                invited_by: access.userId,
                expires_at: expiresAt,
              })
              .select('id')
              .single()
          : primaryInviteInsert;

      if (!inviteInsertResult.error && inviteInsertResult.data) {
        createdClientCandidate = true;
      }
    }
  }

  return Response.json({
    case: {
      id: data.id,
      title: data.title,
      caseCode: data.case_code ?? null,
      tags: data.tags ?? [],
      status: data.status,
      updatedAt: data.updated_at,
    },
    clientCandidateCreated: createdClientCandidate,
  });
}
