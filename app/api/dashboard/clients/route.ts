import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';

const createClientInviteSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(3).max(120),
  username: z.string().trim().min(3).max(40).regex(/^[a-z0-9._]+$/).optional(),
  tcIdentity: z.string().trim().max(32).optional(),
  contactName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  partyType: z.enum(['plaintiff', 'defendant', 'consultant']).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export async function GET(request: Request) {
  try {
    const access = await requireInternalOfficeUser();
    if (!access.ok) {
      return Response.json({ error: access.message }, { status: access.status });
    }

    const supabase = access.supabase;

    const url = new URL(request.url);
    const query = (url.searchParams.get('query') ?? '').trim().toLowerCase();

    const [clientsResult, invitesResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, role, created_at, updated_at')
        .eq('role', 'client')
        .order('updated_at', { ascending: false })
        .limit(300),
      supabase
        .from('user_invites')
        .select('id, email, full_name, username, tc_identity, contact_name, phone, party_type, target_role, expires_at, accepted_at, created_at')
        .eq('target_role', 'client')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const invitesResultFallback =
      invitesResult.error?.code === '42703'
        ? await supabase
            .from('user_invites')
            .select('id, email, target_role, expires_at, accepted_at, created_at')
            .eq('target_role', 'client')
            .order('created_at', { ascending: false })
            .limit(50)
        : invitesResult;

    if (clientsResult.error) {
      return Response.json({ error: 'Müvekkil listesi alınamadı.' }, { status: 500 });
    }

    if (invitesResultFallback.error) {
      return Response.json({ error: 'Müvekkil davetleri alınamadı.' }, { status: 500 });
    }

    const clients = clientsResult.data ?? [];
    const invites = invitesResultFallback.data ?? [];
    const clientIds = clients.map((item) => item.id);

    const casesResult = clientIds.length
      ? await supabase
          .from('cases')
          .select('id, client_id, status')
          .in('client_id', clientIds)
      : { data: [], error: null };

    if (casesResult.error) {
      return Response.json({ error: 'Müvekkil dosya istatistikleri alınamadı.' }, { status: 500 });
    }

    const cases = casesResult.data ?? [];
    const countsByClientId = new Map<string, { total: number; open: number }>();

    cases.forEach((item) => {
      if (!item.client_id) {
        return;
      }

      const current = countsByClientId.get(item.client_id) ?? { total: 0, open: 0 };
      current.total += 1;
      if (item.status === 'open' || item.status === 'in_progress') {
        current.open += 1;
      }
      countsByClientId.set(item.client_id, current);
    });

    const mappedClients = clients.map((item) => {
      const counts = countsByClientId.get(item.id) ?? { total: 0, open: 0 };
      return {
        id: item.id,
        fullName: item.full_name,
        username: null,
        email: null,
        status: 'registered' as const,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        caseCount: counts.total,
        openCaseCount: counts.open,
      };
    });

    const mappedInvites = invites.map((item) => ({
      id: item.id,
      fullName: ('full_name' in item ? item.full_name : null) ?? null,
      username: ('username' in item ? item.username : null) ?? null,
      tcIdentity: ('tc_identity' in item ? item.tc_identity : null) ?? null,
      contactName: ('contact_name' in item ? item.contact_name : null) ?? null,
      phone: ('phone' in item ? item.phone : null) ?? null,
      partyType: ('party_type' in item ? item.party_type : null) ?? null,
      email: item.email,
      status: item.accepted_at ? ('accepted' as const) : ('invited' as const),
      targetRole: item.target_role,
      expiresAt: item.expires_at,
      acceptedAt: item.accepted_at,
      createdAt: item.created_at,
    }));

    const normalizedQuery = query.toLowerCase();
    const filteredClients =
      normalizedQuery.length === 0
        ? mappedClients
        : mappedClients.filter((item) => item.fullName.toLowerCase().includes(normalizedQuery));

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
          username: item.username,
          email: item.email,
          status: item.status,
          clientId: item.id,
        })),
        ...filteredInvites.map((item) => ({
          id: item.id,
          type: 'invite' as const,
          fullName: item.fullName,
          username: item.username,
          email: item.email,
          status: item.status,
          clientId: null,
        })),
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Müvekkil verileri işlenemedi.';
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

    const supabase = access.supabase;
    const primaryInsert = await supabase
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
        expires_at: expiresAt,
      })
      .select('id, email, full_name, username, tc_identity, contact_name, phone, party_type, target_role, expires_at, accepted_at, created_at')
      .single();

    const insertResult =
      primaryInsert.error?.code === '42703'
        ? await supabase
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
        : primaryInsert;

    const data = insertResult.data;
    const error = insertResult.error;

    if (error || !data) {
      if (error?.code === '23505') {
        return Response.json({ error: 'Bu e-posta için mevcut bir davet bulunuyor.' }, { status: 409 });
      }
      return Response.json({ error: 'Müvekkil daveti oluşturulamadı.' }, { status: 500 });
    }

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
      inviteUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Müvekkil daveti oluşturulamadı.';
    return Response.json({ error: message }, { status: 500 });
  }
}
