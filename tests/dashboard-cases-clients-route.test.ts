import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  requireInternalOfficeUser: vi.fn(),
  createAdminClient: vi.fn(),
  canAccessCase: vi.fn(),
  logDashboardAudit: vi.fn(),
}));

vi.mock('@/lib/office/team-access', () => ({
  requireInternalOfficeUser: mocked.requireInternalOfficeUser,
}));

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: mocked.createAdminClient,
}));

vi.mock('@/lib/dashboard/access', () => ({
  canAccessCase: mocked.canAccessCase,
}));

vi.mock('@/lib/dashboard/audit', () => ({
  logDashboardAudit: mocked.logDashboardAudit,
}));

import { DELETE, POST } from '@/app/api/dashboard/cases/clients/route';

function buildClientsLookupChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.is.mockResolvedValue(result);
  return chain;
}

function buildCaseClientsUpsertChain(result: unknown) {
  return {
    upsert: vi.fn().mockResolvedValue(result),
  };
}

function buildCaseClientsDeleteChain(result: unknown) {
  const chain = {
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
  };
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockResolvedValue(result);
  return chain;
}

describe('/api/dashboard/cases/clients authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST returns 403 when case access is denied', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'assistant-user',
      role: 'assistant',
    });
    mocked.canAccessCase.mockResolvedValue(false);
    const admin = { from: vi.fn() };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(
      new Request('http://localhost/api/dashboard/cases/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: '11111111-1111-4111-8111-111111111111',
          clientIds: ['22222222-2222-4222-8222-222222222222'],
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Bu dosyada müvekkil esleme yetkiniz yok.');
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('POST links clients for authorized lawyer', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'lawyer-user',
      role: 'lawyer',
    });
    mocked.canAccessCase.mockResolvedValue(true);

    const clientsLookup = buildClientsLookupChain({
      data: [{ id: '22222222-2222-4222-8222-222222222222' }],
      error: null,
    });
    const upsertChain = buildCaseClientsUpsertChain({ error: null });
    const timelineInsert = { insert: vi.fn().mockResolvedValue({ error: null }) };
    const admin = {
      from: vi
        .fn()
        .mockReturnValueOnce(clientsLookup)
        .mockReturnValueOnce(upsertChain)
        .mockReturnValueOnce(timelineInsert),
    };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(
      new Request('http://localhost/api/dashboard/cases/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: '11111111-1111-4111-8111-111111111111',
          clientIds: ['22222222-2222-4222-8222-222222222222'],
          relationNote: 'Asil',
        }),
      }),
    );
    const payload = (await response.json()) as { linkedCount?: number };

    expect(response.status).toBe(200);
    expect(payload.linkedCount).toBe(1);
    expect(mocked.logDashboardAudit).toHaveBeenCalled();
  });

  it('DELETE returns 403 when case access is denied', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'assistant-user',
      role: 'assistant',
    });
    mocked.canAccessCase.mockResolvedValue(false);
    const admin = { from: vi.fn() };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await DELETE(
      new Request('http://localhost/api/dashboard/cases/clients', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: '11111111-1111-4111-8111-111111111111',
          clientId: '22222222-2222-4222-8222-222222222222',
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Bu dosyada müvekkil esleme yetkiniz yok.');
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('DELETE unlinks client for authorized lawyer', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'lawyer-user',
      role: 'lawyer',
    });
    mocked.canAccessCase.mockResolvedValue(true);

    const deleteChain = buildCaseClientsDeleteChain({ error: null });
    const timelineInsert = { insert: vi.fn().mockResolvedValue({ error: null }) };
    const admin = {
      from: vi.fn().mockReturnValueOnce(deleteChain).mockReturnValueOnce(timelineInsert),
    };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await DELETE(
      new Request('http://localhost/api/dashboard/cases/clients', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: '11111111-1111-4111-8111-111111111111',
          clientId: '22222222-2222-4222-8222-222222222222',
        }),
      }),
    );
    const payload = (await response.json()) as { success?: boolean };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mocked.logDashboardAudit).toHaveBeenCalled();
  });
});
