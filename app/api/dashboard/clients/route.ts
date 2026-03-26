import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { logDashboardAudit } from '@/lib/dashboard/audit';
import { createAdminClient } from '@/utils/supabase/admin';
import { resolveAccessibleClientIds, resolveInternalUserBureauScope } from '@/lib/dashboard/client-access';

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
  invited_by?: string | null;
  invited_client_id?: string | null;
};

type InviteInsertData = {
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
};

type AtomicClientInviteRow = {
  client_id: string;
  client_full_name: string;
  client_email: string | null;
  client_file_no: string | null;
  client_public_ref_code: string | null;
  invite_id: string;
  invite_email: string;
  invite_full_name: string | null;
  invite_username: string | null;
  invite_tc_identity: string | null;
  invite_contact_name: string | null;
  invite_phone: string | null;
  invite_party_type: 'plaintiff' | 'defendant' | 'consultant' | null;
  invite_target_role: 'client';
  invite_expires_at: string;
  invite_accepted_at: string | null;
  invite_created_at: string;
};

function filterInvitesByScope(
  invites: InviteRecord[],
  input: {
    bureauProfileIds: string[];
    allowedClientIds: Set<string>;
  },
) {
  const profileIdSet = new Set(input.bureauProfileIds);
  return invites.filter((item) => {
    if (typeof item.invited_by === 'string' && profileIdSet.has(item.invited_by)) {
      return true;
    }
    if (typeof item.invited_client_id === 'string' && input.allowedClientIds.has(item.invited_client_id)) {
      return true;
    }
    return false;
  });
}

async function listInvites(admin: ReturnType<typeof createAdminClient>) {
  const queryWithClientLink = await admin
    .from('user_invites')
    .select('id, email, full_name, username, tc_identity, contact_name, phone, party_type, target_role, expires_at, accepted_at, created_at, invited_by, invited_client_id')
    .eq('target_role', 'client')
    .order('created_at', { ascending: false })
    .limit(400);

  if (!queryWithClientLink.error) {
    return queryWithClientLink;
  }

  const queryWithInviter = await admin
    .from('user_invites')
    .select('id, email, full_name, username, tc_identity, contact_name, phone, party_type, target_role, expires_at, accepted_at, created_at, invited_by')
    .eq('target_role', 'client')
    .order('created_at', { ascending: false })
    .limit(400);

  if (!queryWithInviter.error) {
    return queryWithInviter;
  }

  return admin
    .from('user_invites')
    .select('id, email, target_role, expires_at, accepted_at, created_at')
    .eq('target_role', 'client')
    .order('created_at', { ascending: false })
    .limit(400);
}

export async function GET(request: Request) {
  try {
    const access = await requireInternalOfficeUser();
    if (!access.ok) {
      return Response.json({ error: access.message }, { status: access.status });
    }

    const admin = createAdminClient();
    const scope = await resolveInternalUserBureauScope(admin, access.userId);
    if (!scope) {
      return Response.json({ error: 'Büro kapsamı doğrulanamadi.' }, { status: 403 });
    }

    const url = new URL(request.url);
    const query = (url.searchParams.get('query') ?? '').trim().toLowerCase();

    const invitesResult = await listInvites(admin);
    const rawInvites = (invitesResult.data ?? []) as InviteRecord[];

    const clientsResult = await admin
      .from('clients')
      .select('id, full_name, email, file_no, status, public_ref_code, created_at, updated_at, profile_id, created_by')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(400);

    const clientsTableMissing = clientsResult.error?.code === '42P01';

    if (clientsTableMissing) {
      const legacyClientsResult = await admin
        .from('profiles')
        .select('id, full_name, created_at, updated_at')
        .eq('role', 'client')
        .eq('bureau_id', scope.bureauId)
        .order('updated_at', { ascending: false })
        .limit(300);

      if (legacyClientsResult.error) {
        return Response.json({ error: 'Müvekkil listesi alinamadi.' }, { status: 500 });
      }

      const legacyClients = legacyClientsResult.data ?? [];
      const clientIds = legacyClients.map((item) => item.id);
      const casesResult = clientIds.length
        ? await admin
            .from('cases')
            .select('id, client_id, status')
            .in('client_id', clientIds)
            .eq('bureau_id', scope.bureauId)
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
          status: 'active' as const,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          caseCount: counts.total,
          openCaseCount: counts.open,
        };
      });

      const normalizedQuery = query.toLowerCase();
      const allowedClientIds = new Set(mappedClients.map((item) => item.id));
      const invites = filterInvitesByScope(rawInvites, {
        bureauProfileIds: scope.bureauProfileIds,
        allowedClientIds,
      });
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

    const clients = (clientsResult.data ?? []) as Array<{
      id: string;
      full_name: string;
      email: string | null;
      file_no: string | null;
      status: 'active' | 'invited' | 'inactive';
      public_ref_code: string;
      created_at: string;
      updated_at: string;
      profile_id: string | null;
      created_by: string | null;
    }>;
    const accessibleClientIds = await resolveAccessibleClientIds(admin, {
      clientIds: clients.map((item) => item.id),
      bureauId: scope.bureauId,
      bureauProfileIds: scope.bureauProfileIds,
    });
    const scopedClients = clients.filter((item) => accessibleClientIds.has(item.id));
    const clientIds = scopedClients.map((item) => item.id);
    const invites = filterInvitesByScope(rawInvites, {
      bureauProfileIds: scope.bureauProfileIds,
      allowedClientIds: accessibleClientIds,
    });

    const caseClientsResult = clientIds.length
      ? await admin
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
      ? await admin
          .from('cases')
          .select('id, status')
          .in('id', caseIds)
          .eq('bureau_id', scope.bureauId)
      : { data: [], error: null };

    if (casesResult.error) {
      return Response.json({ error: 'Müvekkil dosya istatistikleri alinamadi.' }, { status: 500 });
    }

    const caseStatusById = new Map((casesResult.data ?? []).map((item) => [item.id, item.status]));
    const countsByClientId = new Map<string, { total: number; open: number }>();

    (caseClientsResult.data ?? []).forEach((item) => {
      if (!caseStatusById.has(item.case_id)) {
        return;
      }
      const current = countsByClientId.get(item.client_id) ?? { total: 0, open: 0 };
      current.total += 1;
      const status = caseStatusById.get(item.case_id);
      if (status === 'open' || status === 'in_progress') {
        current.open += 1;
      }
      countsByClientId.set(item.client_id, current);
    });

    const mappedClients = scopedClients.map((item) => {
      const counts = countsByClientId.get(item.id) ?? { total: 0, open: 0 };
      return {
        id: item.id,
        fullName: item.full_name,
        email: item.email,
        fileNo: item.file_no,
        publicRefCode: item.public_ref_code,
        status: item.status,
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
    const admin = createAdminClient();
    const scope = await resolveInternalUserBureauScope(admin, access.userId);
    if (!scope) {
      return Response.json({ error: 'Büro kapsamı doğrulanamadi.' }, { status: 403 });
    }

    const parsed = createClientInviteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: 'Geçersiz müvekkil davet verisi.' }, { status: 400 });
    }

    const payload = parsed.data;
    const normalizedEmail = payload.email.trim().toLowerCase();
    const token = `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
    const expiresAt = new Date(Date.now() + payload.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const inviteUrl = `/signup?invite=${token}`;
    const duplicateAccountOrInviteMessage = 'Bu e-posta için aktif bir hesap veya davet zaten mevcut.';

    let clientId: string | null = null;
    let createdClientId: string | null = null;
    let clientPayload: { id: string; full_name: string; email: string | null; file_no: string | null; public_ref_code: string | null } | null = null;
    let invitePayload: InviteInsertData | null = null;
    let usedAtomicCreate = false;
    const activeInviteResult = await admin
      .from('user_invites')
      .select('id')
      .eq('target_role', 'client')
      .ilike('email', normalizedEmail)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .limit(1);

    if (activeInviteResult.error) {
      return Response.json({ error: 'Müvekkil daveti olusturulamadi.' }, { status: 500 });
    }

    if ((activeInviteResult.data ?? []).length > 0) {
      return Response.json({ error: duplicateAccountOrInviteMessage }, { status: 409 });
    }

    const clientsTableProbe = await admin.from('clients').select('id').limit(1);
    const clientsTableMissing = clientsTableProbe.error?.code === '42P01';

    if (!clientsTableMissing) {
      const existingClientsResult = await admin
        .from('clients')
        .select('id, full_name, email, file_no, public_ref_code')
        .ilike('email', normalizedEmail)
        .is('deleted_at', null)
        .limit(20);

      if (existingClientsResult.error) {
        return Response.json({ error: 'Müvekkil kaydi olusturulamadi.' }, { status: 500 });
      }

      const existingClients = (existingClientsResult.data ?? []) as Array<{
        id: string;
        full_name: string;
        email: string | null;
        file_no: string | null;
        public_ref_code: string | null;
      }>;

      if (existingClients.length > 0) {
        const allowedExistingClientIds = await resolveAccessibleClientIds(admin, {
          clientIds: existingClients.map((item) => item.id),
          bureauId: scope.bureauId,
          bureauProfileIds: scope.bureauProfileIds,
        });
        const selectedClient = existingClients.find((item) => allowedExistingClientIds.has(item.id)) ?? null;

        if (!selectedClient) {
          return Response.json({ error: duplicateAccountOrInviteMessage }, { status: 409 });
        }

        clientId = selectedClient.id;
        clientPayload = selectedClient;
      } else {
        const atomicCreateResult = await admin.rpc('create_client_invite_atomic', {
          p_full_name: payload.fullName.trim(),
          p_email: normalizedEmail,
          p_phone: payload.phone?.trim() || null,
          p_tc_identity: payload.tcIdentity?.trim() || null,
          p_party_type: payload.partyType || null,
          p_file_no: payload.fileNo?.trim() || null,
          p_created_by: access.userId,
          p_invited_by: access.userId,
          p_username: payload.username?.trim().toLowerCase() || null,
          p_contact_name: payload.contactName?.trim() || null,
          p_expires_at: expiresAt,
          p_token: token,
        });

        if (atomicCreateResult.error) {
          const atomicErrorMessage = atomicCreateResult.error.message ?? '';
          const missingAtomicFn =
            atomicCreateResult.error.code === 'PGRST202'
            || (atomicCreateResult.error.code === '42883' && atomicErrorMessage.includes('create_client_invite_atomic'));

          if (!missingAtomicFn) {
            if (atomicCreateResult.error.code === '23505') {
              return Response.json({ error: duplicateAccountOrInviteMessage }, { status: 409 });
            }
            return Response.json({ error: 'Müvekkil kaydi olusturulamadi.' }, { status: 500 });
          }
        } else {
          const atomicRows = (atomicCreateResult.data ?? []) as AtomicClientInviteRow[];
          const atomicRow = atomicRows[0];

          if (!atomicRow) {
            return Response.json({ error: 'Müvekkil kaydi olusturulamadi.' }, { status: 500 });
          }

          clientId = atomicRow.client_id;
          clientPayload = {
            id: atomicRow.client_id,
            full_name: atomicRow.client_full_name,
            email: atomicRow.client_email,
            file_no: atomicRow.client_file_no,
            public_ref_code: atomicRow.client_public_ref_code,
          };
          invitePayload = {
            id: atomicRow.invite_id,
            email: atomicRow.invite_email,
            full_name: atomicRow.invite_full_name,
            username: atomicRow.invite_username,
            tc_identity: atomicRow.invite_tc_identity,
            contact_name: atomicRow.invite_contact_name,
            phone: atomicRow.invite_phone,
            party_type: atomicRow.invite_party_type,
            target_role: atomicRow.invite_target_role,
            expires_at: atomicRow.invite_expires_at,
            accepted_at: atomicRow.invite_accepted_at,
            created_at: atomicRow.invite_created_at,
          };
          usedAtomicCreate = true;
        }

        if (!usedAtomicCreate) {
          const clientInsert = await admin
            .from('clients')
            .insert({
              full_name: payload.fullName.trim(),
              email: normalizedEmail,
              phone: payload.phone?.trim() || null,
              tc_identity: payload.tcIdentity?.trim() || null,
              party_type: payload.partyType || null,
              file_no: payload.fileNo?.trim() || null,
              status: 'invited',
              created_by: access.userId,
            })
            .select('id, full_name, email, file_no, public_ref_code')
            .single();

          if (clientInsert.error || !clientInsert.data) {
            if (clientInsert.error?.code === '23505') {
              return Response.json({ error: duplicateAccountOrInviteMessage }, { status: 409 });
            }
            return Response.json({ error: 'Müvekkil kaydi olusturulamadi.' }, { status: 500 });
          }

          clientId = clientInsert.data.id;
          createdClientId = clientInsert.data.id;
          clientPayload = clientInsert.data;
        }
      }
    }

    if (!invitePayload) {
      const inviteInsert = await admin
        .from('user_invites')
        .insert({
          email: normalizedEmail,
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
          ? await admin
              .from('user_invites')
              .insert({
                email: normalizedEmail,
                target_role: 'client',
                token,
                invited_by: access.userId,
                expires_at: expiresAt,
              })
              .select('id, email, target_role, expires_at, accepted_at, created_at')
              .single()
          : inviteInsert;

      const data = inviteInsertResult.data as InviteInsertData | null;
      const error = inviteInsertResult.error;

      if (error || !data) {
        if (error?.code === '23505') {
          if (createdClientId) {
            await admin
              .from('clients')
              .update({
                status: 'inactive',
                deleted_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', createdClientId)
              .is('deleted_at', null);
          }
          return Response.json({ error: duplicateAccountOrInviteMessage }, { status: 409 });
        }
        if (createdClientId) {
          await admin
            .from('clients')
            .update({
              status: 'inactive',
              deleted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', createdClientId)
            .is('deleted_at', null);
        }
        return Response.json({ error: 'Müvekkil daveti olusturulamadi.' }, { status: 500 });
      }

      invitePayload = data;
    }

    if (!invitePayload) {
      return Response.json({ error: 'Müvekkil daveti olusturulamadi.' }, { status: 500 });
    }

    if (clientId && !usedAtomicCreate) {
      await admin
        .from('clients')
        .update({ source_invite_id: invitePayload.id })
        .eq('id', clientId);
    }

    await logDashboardAudit(access.supabase, {
      actorUserId: access.userId,
      action: 'client_invited',
      entityType: 'client',
      entityId: clientId,
      metadata: {
        inviteId: invitePayload.id,
        email: invitePayload.email,
      },
    });

    return Response.json({
      invite: {
        id: invitePayload.id,
        email: invitePayload.email,
        fullName: invitePayload.full_name ?? payload.fullName.trim(),
        username: invitePayload.username ?? payload.username?.trim().toLowerCase() ?? null,
        tcIdentity: invitePayload.tc_identity ?? payload.tcIdentity?.trim() ?? null,
        contactName: invitePayload.contact_name ?? payload.contactName?.trim() ?? null,
        phone: invitePayload.phone ?? payload.phone?.trim() ?? null,
        partyType: invitePayload.party_type ?? payload.partyType ?? null,
        targetRole: invitePayload.target_role,
        expiresAt: invitePayload.expires_at,
        acceptedAt: invitePayload.accepted_at,
        createdAt: invitePayload.created_at,
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

