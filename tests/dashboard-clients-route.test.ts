import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  requireInternalOfficeUser: vi.fn(),
  createAdminClient: vi.fn(),
  resolveInternalUserBureauScope: vi.fn(),
  resolveAccessibleClientIds: vi.fn(),
  logDashboardAudit: vi.fn(),
}));

vi.mock('@/lib/office/team-access', () => ({
  requireInternalOfficeUser: mocked.requireInternalOfficeUser,
}));

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: mocked.createAdminClient,
}));

vi.mock('@/lib/dashboard/client-access', () => ({
  resolveInternalUserBureauScope: mocked.resolveInternalUserBureauScope,
  resolveAccessibleClientIds: mocked.resolveAccessibleClientIds,
}));

vi.mock('@/lib/dashboard/audit', () => ({
  logDashboardAudit: mocked.logDashboardAudit,
}));

import { POST } from '@/app/api/dashboard/clients/route';

function buildActiveInviteLookupChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    ilike: vi.fn(),
    is: vi.fn(),
    gt: vi.fn(),
    limit: vi.fn(),
  };

  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.ilike.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.gt.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);

  return chain;
}

function buildClientsProbeChain(result: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue(result),
    }),
  };
}

function buildExistingClientsChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    ilike: vi.fn(),
    is: vi.fn(),
    limit: vi.fn(),
  };

  chain.select.mockReturnValue(chain);
  chain.ilike.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);

  return chain;
}

function buildInviteInsertChain(result: unknown) {
  const chain = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };

  chain.insert.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.single.mockResolvedValue(result);

  return chain;
}

function buildClientUpdateChain(result: unknown) {
  const chain = {
    update: vi.fn(),
    eq: vi.fn(),
  };

  chain.update.mockReturnValue(chain);
  chain.eq.mockResolvedValue(result);

  return chain;
}

describe('POST /api/dashboard/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 409 with generic message when the email exists only in another office scope', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'lawyer',
      supabase: {},
    });
    mocked.resolveInternalUserBureauScope.mockResolvedValue({
      bureauId: 'bureau-1',
      bureauProfileIds: ['actor-user', 'assistant-user'],
    });
    mocked.resolveAccessibleClientIds.mockResolvedValue(new Set());

    const activeInviteLookupChain = buildActiveInviteLookupChain({
      data: [],
      error: null,
    });
    const clientsProbeChain = buildClientsProbeChain({
      data: [{ id: 'probe' }],
      error: null,
    });
    const existingClientsChain = buildExistingClientsChain({
      data: [
        {
          id: 'foreign-client',
          full_name: 'Foreign Client',
          email: 'foreign@example.com',
          file_no: null,
          public_ref_code: 'CLI-AAAAAA',
        },
      ],
      error: null,
    });

    const admin = {
      from: vi.fn(),
    };
    admin.from
      .mockReturnValueOnce(activeInviteLookupChain)
      .mockReturnValueOnce(clientsProbeChain)
      .mockReturnValueOnce(existingClientsChain);
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(
      new Request('http://localhost/api/dashboard/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'foreign@example.com',
          fullName: 'Test User',
          expiresInDays: 7,
        }),
      }),
    );

    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(409);
    expect(payload.error).toBe('Bu e-posta için aktif bir hesap veya davet zaten mevcut.');
    expect(mocked.resolveAccessibleClientIds).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        clientIds: ['foreign-client'],
        bureauId: 'bureau-1',
      }),
    );
    expect(mocked.logDashboardAudit).not.toHaveBeenCalled();
  });

  it('reuses in-scope existing client and creates invite successfully', async () => {
    const supabase = {};
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'lawyer',
      supabase,
    });
    mocked.resolveInternalUserBureauScope.mockResolvedValue({
      bureauId: 'bureau-1',
      bureauProfileIds: ['actor-user', 'assistant-user'],
    });
    mocked.resolveAccessibleClientIds.mockResolvedValue(new Set(['existing-client']));

    const activeInviteLookupChain = buildActiveInviteLookupChain({
      data: [],
      error: null,
    });
    const clientsProbeChain = buildClientsProbeChain({
      data: [{ id: 'probe' }],
      error: null,
    });
    const existingClientsChain = buildExistingClientsChain({
      data: [
        {
          id: 'existing-client',
          full_name: 'Scoped Client',
          email: 'scoped@example.com',
          file_no: '2026/11',
          public_ref_code: 'CLI-SCOPED',
        },
      ],
      error: null,
    });
    const inviteInsertChain = buildInviteInsertChain({
      data: {
        id: 'invite-1',
        email: 'scoped@example.com',
        full_name: 'Scoped Client',
        username: 'scopedclient',
        tc_identity: null,
        contact_name: null,
        phone: null,
        party_type: null,
        target_role: 'client',
        expires_at: '2026-04-01T00:00:00.000Z',
        accepted_at: null,
        created_at: '2026-03-27T00:00:00.000Z',
      },
      error: null,
    });
    const clientUpdateChain = buildClientUpdateChain({
      data: null,
      error: null,
    });

    const admin = {
      from: vi.fn(),
    };
    admin.from
      .mockReturnValueOnce(activeInviteLookupChain)
      .mockReturnValueOnce(clientsProbeChain)
      .mockReturnValueOnce(existingClientsChain)
      .mockReturnValueOnce(inviteInsertChain)
      .mockReturnValueOnce(clientUpdateChain);
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(
      new Request('http://localhost/api/dashboard/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'scoped@example.com',
          fullName: 'Scoped Client',
          username: 'scopedclient',
          expiresInDays: 7,
        }),
      }),
    );

    const payload = (await response.json()) as {
      client?: { id: string; fullName: string };
      invite?: { id: string; email: string };
      inviteUrl?: string;
      error?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.error).toBeUndefined();
    expect(payload.client).toEqual({
      id: 'existing-client',
      fullName: 'Scoped Client',
      email: 'scoped@example.com',
      fileNo: '2026/11',
      publicRefCode: 'CLI-SCOPED',
    });
    expect(payload.invite?.id).toBe('invite-1');
    expect(payload.invite?.email).toBe('scoped@example.com');
    expect(typeof payload.inviteUrl).toBe('string');
    expect(payload.inviteUrl).toContain('/signup?invite=');

    expect(mocked.resolveAccessibleClientIds).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        clientIds: ['existing-client'],
        bureauId: 'bureau-1',
      }),
    );
    expect(inviteInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        invited_client_id: 'existing-client',
      }),
    );
    expect(clientUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        source_invite_id: 'invite-1',
      }),
    );
    expect(mocked.logDashboardAudit).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        action: 'client_invited',
        entityId: 'existing-client',
      }),
    );
  });

  it('uses atomic rpc path for new client + invite creation when function is available', async () => {
    const supabase = {};
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'lawyer',
      supabase,
    });
    mocked.resolveInternalUserBureauScope.mockResolvedValue({
      bureauId: 'bureau-1',
      bureauProfileIds: ['actor-user'],
    });

    const activeInviteLookupChain = buildActiveInviteLookupChain({
      data: [],
      error: null,
    });
    const clientsProbeChain = buildClientsProbeChain({
      data: [{ id: 'probe' }],
      error: null,
    });
    const existingClientsChain = buildExistingClientsChain({
      data: [],
      error: null,
    });

    const admin = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            client_id: 'client-new-1',
            client_full_name: 'New Atomic Client',
            client_email: 'newatomic@example.com',
            client_file_no: '2026/42',
            client_public_ref_code: 'CLI-NEW42',
            invite_id: 'invite-new-1',
            invite_email: 'newatomic@example.com',
            invite_full_name: 'New Atomic Client',
            invite_username: 'newatomic',
            invite_tc_identity: null,
            invite_contact_name: null,
            invite_phone: null,
            invite_party_type: null,
            invite_target_role: 'client',
            invite_expires_at: '2026-04-01T00:00:00.000Z',
            invite_accepted_at: null,
            invite_created_at: '2026-03-27T00:00:00.000Z',
          },
        ],
        error: null,
      }),
    };
    admin.from
      .mockReturnValueOnce(activeInviteLookupChain)
      .mockReturnValueOnce(clientsProbeChain)
      .mockReturnValueOnce(existingClientsChain);
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(
      new Request('http://localhost/api/dashboard/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newatomic@example.com',
          fullName: 'New Atomic Client',
          username: 'newatomic',
          fileNo: '2026/42',
          expiresInDays: 7,
        }),
      }),
    );

    const payload = (await response.json()) as {
      client?: { id: string; fullName: string; email: string | null };
      invite?: { id: string; email: string; targetRole: string };
      error?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.error).toBeUndefined();
    expect(payload.client).toEqual({
      id: 'client-new-1',
      fullName: 'New Atomic Client',
      email: 'newatomic@example.com',
      fileNo: '2026/42',
      publicRefCode: 'CLI-NEW42',
    });
    expect(payload.invite).toEqual(
      expect.objectContaining({
        id: 'invite-new-1',
        email: 'newatomic@example.com',
        targetRole: 'client',
      }),
    );
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_client_invite_atomic',
      expect.objectContaining({
        p_email: 'newatomic@example.com',
        p_full_name: 'New Atomic Client',
      }),
    );
    expect(mocked.logDashboardAudit).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        action: 'client_invited',
        entityId: 'client-new-1',
      }),
    );
  });

  it('returns 409 when an active pending invite already exists for the email', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'lawyer',
      supabase: {},
    });
    mocked.resolveInternalUserBureauScope.mockResolvedValue({
      bureauId: 'bureau-1',
      bureauProfileIds: ['actor-user'],
    });

    const activeInviteLookupChain = buildActiveInviteLookupChain({
      data: [{ id: 'invite-active-1' }],
      error: null,
    });

    const admin = {
      from: vi.fn(),
    };
    admin.from.mockReturnValueOnce(activeInviteLookupChain);
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(
      new Request('http://localhost/api/dashboard/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'existinginvite@example.com',
          fullName: 'Existing Invite',
          expiresInDays: 7,
        }),
      }),
    );

    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(409);
    expect(payload.error).toBe('Bu e-posta için aktif bir hesap veya davet zaten mevcut.');
    expect(mocked.resolveAccessibleClientIds).not.toHaveBeenCalled();
    expect(mocked.logDashboardAudit).not.toHaveBeenCalled();
  });
});
