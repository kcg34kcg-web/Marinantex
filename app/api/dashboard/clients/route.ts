import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const createClientInviteSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(3).max(120),
  username: z.string().trim().min(3).max(40).regex(/^[a-z0-9._]+$/).optional(),
  tcIdentity: z.string().trim().max(32).optional(),
  contactName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  partyType: z.enum(['plaintiff', 'defendant', 'consultant']).optional(),
  fileNo: z.string().trim().max(64).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

type InviteRecord = {
  id: string;
  email: string;
  full_name?: string | null;
  username?: string | null;
  tc_identity?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  party_type?: 'plaintiff' | 'defendant' | 'consultant' | null;
  target_role: 'client';
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  invited_client_id?: string | null;
};

async function listInvites(access: Awaited<ReturnType<typeof requireInternalOfficeUser>>) {
  if (!access.ok) {
    return { data: [], error: { message: access.message } };
  }

  const query = await access.supabase
    .from('user_invites')
    .select('id, email, full_name, username, tc_identity, contact_name, phone, party_type, target_role, expires_at, accepted_at, created_at, invited_client_id')
    .eq('target_role', 'client')
    .order('created_at', { ascending: false })
    .limit(100);

  if (!query.error) {
    return query;
  }

  return access.supabase
    .from('user_invites')
    .select('id, email, target_role, expires_at, accepted_at, created_at')
    .eq('target_role', 'client')
    .order('created_at', { ascending: false })
    .limit(100);
}

export async function GET(request: Request) {
  try {
    const access = await requireInternalOfficeUser();
    if (!access.ok) {
      return Response.json({ error: access.message }, { status: access.status });
    }

    const url = new URL(request.url);
    const query = (url.searchParams.get('query') ?? '').trim().toLowerCase();

    const invitesResult = await listInvites(access);
    const invites = (invitesResult.data ?? []) as InviteRecord[];

    const clientsResult = await access.supabase
      .from('clients')
      .select('id, full_name, email, file_no, status, public_ref_code, created_at, updated_at')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(400);

    const clientsTableMissing = clientsResult.error?.code === '42P01';

    if (clientsTableMissing) {
      const legacyClientsResult = await access.supabase
        .from('profiles')
        .select('id, full_name, created_at, updated_at')
        .eq('role', 'client')
        .order('updated_at', { ascending: false })
        .limit(300);

      if (legacyClientsResult.error) {
        return Response.json({ error: 'Müvekkil listesi alinamadi.' }, { status: 500 });
      }

      const legacyClients = legacyClientsResult.data ?? [];
      const clientIds = legacyClients.map((item) => item.id);
      const casesResult = clientIds.length
        ? await access.supabase.from('cases').select('id, client_id, status').in('client_id', clientIds)
        : { data: [], error: null };

      if (casesResult.error) {
        return Response.json({ error: 'Müvekkil dosya istatistikleri alinamadi.' }, { status: 500 });
      }

      const countsByClientId = new Map<string, { total: number; open: number }>();
      (casesResult.data ?? []).forEach((item) => {
        if (!item.client_id) return;
        const current = countsByClientId.get(item.client_id) ?? { total: 0, open: 0 };
        current.total += 1;
        if (item.status === 'open' || item.status === 'in_progress') {
          current.open += 1;
        }
        countsByClientId.set(item.client_id, current);
      });

      const mappedClients = legacyClients.map((item) => {
        const counts = countsByClientId.get(item.id) ?? { total: 0, open: 0 };
        return {
          id: item.id,
          fullName: item.full_name,
          email: null,
          fileNo: null,
          publicRefCode: null,
          status: 'registered' as const,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          caseCount: counts.total,
          openCaseCount: counts.open,
        };
      });

      const normalizedQuery = query.toLowerCase();
      const filteredClients =
        normalizedQuery.length === 0
          ? mappedClients
          : mappedClients.filter((item) => item.fullName.toLowerCase().includes(normalizedQuery));

      const mappedInvites = invites.map((item) => ({
        id: item.id,
        fullName: item.full_name ?? null,
        username: item.username ?? null,
        tcIdentity: item.tc_identity ?? null,
        contactName: item.contact_name ?? null,
        phone: item.phone ?? null,
        partyType: item.party_type ?? null,
        email: item.email,
        status: item.accepted_at ? ('accepted' as const) : ('invited' as const),
        targetRole: item.target_role,
        expiresAt: item.expires_at,
        acceptedAt: item.accepted_at,
        createdAt: item.created_at,
        invitedClientId: item.invited_client_id ?? null,
      }));

      return Response.json({
        clients: filteredClients,
        invites: mappedInvites,
        directory: [
          ...filteredClients.map((item) => ({
            id: item.id,
            type: 'client' as const,
            fullName: item.fullName,
            username: null,
            email: item.email,
            status: item.status,
            clientId: item.id,
            fileNo: item.fileNo,
            publicRefCode: item.publicRefCode,
          })),
          ...mappedInvites.map((item) => ({
            id: item.id,
            type: 'invite' as const,
            fullName: item.fullName,
            username: item.username,
            email: item.email,
            status: item.status,
            clientId: item.invitedClientId,
            fileNo: null,
            publicRefCode: null,
          })),
        ],
      });
    }

    if (clientsResult.error) {
      return Response.json({ error: 'Müvekkil listesi alinamadi.' }, { status: 500 });
    }

    const clients = clientsResult.data ?? [];
    const clientIds = clients.map((item) => item.id);

    const caseClientsResult = clientIds.length
      ? await access.supabase
          .from('case_clients')
          .select('case_id, client_id')
          .in('client_id', clientIds)
          .is('deleted_at', null)
      : { data: [], error: null };

    if (caseClientsResult.error) {
      return Response.json({ error: 'Müvekkil dosya iliskileri alinamadi.' }, { status: 500 });
    }

    const caseIds = [...new Set((caseClientsResult.data ?? []).map((item) => item.case_id))];
    const casesResult = caseIds.length
      ? await access.supabase.from('cases').select('id, status').in('id', caseIds)
      : { data: [], error: null };

    if (casesResult.error) {
      return Response.json({ error: 'Müvekkil dosya istatistikleri alinamadi.' }, { status: 500 });
    }

    const caseStatusById = new Map((casesResult.data ?? []).map((item) => [item.id, item.status]));
    const countsByClientId = new Map<string, { total: number; open: number }>();

    (caseClientsResult.data ?? []).forEach((item) => {
      const current = countsByClientId.get(item.client_id) ?? { total: 0, open: 0 };
      current.total += 1;
      const status = caseStatusById.get(item.case_id);
      if (status === 'open' || status === 'in_progress') {
        current.open += 1;
      }
      countsByClientId.set(item.client_id, current);
    });

    const mappedClients = clients.map((item) => {
      const counts = countsByClientId.get(item.id) ?? { total: 0, open: 0 };
      return {
        id: item.id,
        fullName: item.full_name,
        email: item.email,
        fileNo: item.file_no,
        publicRefCode: item.public_ref_code,
        status: item.status === 'invited' ? ('invited' as const) : ('registered' as const),
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        caseCount: counts.total,
        openCaseCount: counts.open,
      };
    });

    const mappedInvites = invites.map((item) => ({
      id: item.id,
      fullName: item.full_name ?? null,
      username: item.username ?? null,
      tcIdentity: item.tc_identity ?? null,
      contactName: item.contact_name ?? null,
      phone: item.phone ?? null,
      partyType: item.party_type ?? null,
      email: item.email,
      status: item.accepted_at ? ('accepted' as const) : ('invited' as const),
      targetRole: item.target_role,
      expiresAt: item.expires_at,
      acceptedAt: item.accepted_at,
      createdAt: item.created_at,
      invitedClientId: item.invited_client_id ?? null,
    }));

    const normalizedQuery = query.toLowerCase();

    const filteredClients =
      normalizedQuery.length === 0
        ? mappedClients
        : mappedClients.filter((item) => {
            const haystack = `${item.fullName} ${item.email ?? ''} ${item.fileNo ?? ''} ${item.publicRefCode ?? ''}`.toLowerCase();
            return haystack.includes(normalizedQuery);
          });

    const filteredInvites =
      normalizedQuery.length === 0
        ? mappedInvites
        : mappedInvites.filter((item) => {
            const haystack = `${item.fullName ?? ''} ${item.username ?? ''} ${item.email ?? ''} ${item.tcIdentity ?? ''} ${item.contactName ?? ''} ${item.phone ?? ''}`.toLowerCase();
            return haystack.includes(normalizedQuery);
          });

    return Response.json({
      clients: filteredClients,
      invites: filteredInvites,
      directory: [
        ...filteredClients.map((item) => ({
          id: item.id,
          type: 'client' as const,
          fullName: item.fullName,
          username: null,
          email: item.email,
          status: item.status,
          clientId: item.id,
          fileNo: item.fileNo,
          publicRefCode: item.publicRefCode,
        })),
        ...filteredInvites.map((item) => ({
          id: item.id,
          type: 'invite' as const,
          fullName: item.fullName,
          username: item.username,
          email: item.email,
          status: item.status,
          clientId: item.invitedClientId,
          fileNo: null,
          publicRefCode: null,
        })),
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Müvekkil verileri islenemedi.';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireInternalOfficeUser();
    if (!access.ok) {
      return Response.json({ error: access.message }, { status: access.status });
    }

    const parsed = createClientInviteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: 'Geçersiz müvekkil davet verisi.' }, { status: 400 });
    }

    const payload = parsed.data;
    const token = `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
    const expiresAt = new Date(Date.now() + payload.expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    const clientInsert = await access.supabase
      .from('clients')
      .insert({
        full_name: payload.fullName.trim(),
        email: payload.email.trim().toLowerCase(),
        phone: payload.phone?.trim() || null,
        tc_identity: payload.tcIdentity?.trim() || null,
        party_type: payload.partyType || null,
        file_no: payload.fileNo?.trim() || null,
        status: 'invited',
        created_by: access.userId,
      })
      .select('id, full_name, email, file_no, public_ref_code')
      .single();

    const clientsTableMissing = clientInsert.error?.code === '42P01';
    let clientId: string | null = null;
    let clientPayload: { id: string; full_name: string; email: string | null; file_no: string | null; public_ref_code: string | null } | null = null;

    if (!clientsTableMissing) {
      if (clientInsert.error || !clientInsert.data) {
        if (clientInsert.error?.code === '23505') {
          return Response.json({ error: 'Bu e-posta ile kayitli müvekkil zaten var.' }, { status: 409 });
        }
        return Response.json({ error: 'Müvekkil kaydi olusturulamadi.' }, { status: 500 });
      }
      clientId = clientInsert.data.id;
      clientPayload = clientInsert.data;
    }

    const inviteInsert = await access.supabase
      .from('user_invites')
      .insert({
        email: payload.email.toLowerCase(),
        full_name: payload.fullName.trim(),
        username: payload.username?.trim().toLowerCase() || null,
        tc_identity: payload.tcIdentity?.trim() || null,
        contact_name: payload.contactName?.trim() || null,
        phone: payload.phone?.trim() || null,
        party_type: payload.partyType || null,
        target_role: 'client',
        token,
        invited_by: access.userId,
        invited_client_id: clientId,
        expires_at: expiresAt,
      })
      .select('id, email, full_name, username, tc_identity, contact_name, phone, party_type, target_role, expires_at, accepted_at, created_at')
      .single();

    const inviteInsertResult =
      inviteInsert.error?.code === '42703'
        ? await access.supabase
            .from('user_invites')
            .insert({
              email: payload.email.toLowerCase(),
              target_role: 'client',
              token,
              invited_by: access.userId,
              expires_at: expiresAt,
            })
            .select('id, email, target_role, expires_at, accepted_at, created_at')
            .single()
        : inviteInsert;

    const data = inviteInsertResult.data;
    const error = inviteInsertResult.error;

    if (error || !data) {
      if (error?.code === '23505') {
        return Response.json({ error: 'Bu e-posta için mevcut bir davet bulunuyor.' }, { status: 409 });
      }
      return Response.json({ error: 'Müvekkil daveti olusturulamadi.' }, { status: 500 });
    }

    if (clientId) {
      await access.supabase
        .from('clients')
        .update({ source_invite_id: data.id })
        .eq('id', clientId);
    }

    await logDashboardAudit(access.supabase, {
      actorUserId: access.userId,
      action: 'client_invited',
      entityType: 'client',
      entityId: clientId,
      metadata: {
        inviteId: data.id,
        email: data.email,
      },
    });

    const origin = new URL(request.url).origin;
    const inviteUrl = `${origin}/signup?invite=${token}`;

    return Response.json({
      invite: {
        id: data.id,
        email: data.email,
        fullName: 'full_name' in data ? data.full_name : payload.fullName.trim(),
        username: 'username' in data ? data.username : payload.username?.trim().toLowerCase() ?? null,
        tcIdentity: 'tc_identity' in data ? data.tc_identity : payload.tcIdentity?.trim() ?? null,
        contactName: 'contact_name' in data ? data.contact_name : payload.contactName?.trim() ?? null,
        phone: 'phone' in data ? data.phone : payload.phone?.trim() ?? null,
        partyType: 'party_type' in data ? data.party_type : payload.partyType ?? null,
        targetRole: data.target_role,
        expiresAt: data.expires_at,
        acceptedAt: data.accepted_at,
        createdAt: data.created_at,
      },
      client: clientPayload
        ? {
            id: clientPayload.id,
            fullName: clientPayload.full_name,
            email: clientPayload.email,
            fileNo: clientPayload.file_no,
            publicRefCode: clientPayload.public_ref_code,
          }
        : null,
      inviteUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Müvekkil daveti olusturulamadi.';
    return Response.json({ error: message }, { status: 500 });
  }
}

