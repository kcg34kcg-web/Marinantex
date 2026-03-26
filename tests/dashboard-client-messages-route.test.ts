import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  requireInternalOfficeUser: vi.fn(),
  createAdminClient: vi.fn(),
  canAccessClient: vi.fn(),
  canAccessCase: vi.fn(),
  logDashboardAudit: vi.fn(),
}));

vi.mock('@/lib/office/team-access', () => ({
  requireInternalOfficeUser: mocked.requireInternalOfficeUser,
}));

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: mocked.createAdminClient,
}));

vi.mock('@/lib/dashboard/client-access', () => ({
  canAccessClient: mocked.canAccessClient,
}));

vi.mock('@/lib/dashboard/access', () => ({
  canAccessCase: mocked.canAccessCase,
}));

vi.mock('@/lib/dashboard/audit', () => ({
  logDashboardAudit: mocked.logDashboardAudit,
}));

import { POST } from '@/app/api/dashboard/clients/[id]/messages/route';

function buildCaseClientLinkChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    limit: vi.fn(),
  };

  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);

  return chain;
}

describe('POST /api/dashboard/clients/[id]/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when provided case is not linked to the client', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'lawyer',
    });
    mocked.canAccessClient.mockResolvedValue(true);
    mocked.canAccessCase.mockResolvedValue(true);

    const caseClientLinkChain = buildCaseClientLinkChain({
      data: [],
      error: null,
    });

    const admin = {
      from: vi.fn().mockReturnValueOnce(caseClientLinkChain),
    };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(
      new Request('http://localhost/api/dashboard/clients/client-1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: 'Merhaba',
          caseId: '07992d5c-b38d-4f40-8f69-8dcd4f8666e7',
          sendEmailAlso: false,
        }),
      }),
      { params: Promise.resolve({ id: 'client-1' }) },
    );

    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Secilen dosya bu müvekkil ile iliskili degil.');
    expect(admin.from).toHaveBeenCalledTimes(1);
    expect(mocked.logDashboardAudit).not.toHaveBeenCalled();
  });
});
