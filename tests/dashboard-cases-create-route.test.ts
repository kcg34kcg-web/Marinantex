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

import { GET, POST } from '@/app/api/dashboard/cases/create/route';

describe('/api/dashboard/cases/create scope checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns 403 when bureau scope cannot be resolved', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'assistant',
    });
    mocked.createAdminClient.mockReturnValue({});
    mocked.resolveInternalUserBureauScope.mockResolvedValue(null);

    const response = await GET();
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Büro kapsamı doğrulanamadi.');
  });

  it('POST returns 403 when bureau scope cannot be resolved', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'assistant',
    });
    mocked.createAdminClient.mockReturnValue({});
    mocked.resolveInternalUserBureauScope.mockResolvedValue(null);

    const response = await POST(
      new Request('http://localhost/api/dashboard/cases/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Yeni Dosya',
          status: 'open',
          autoCode: true,
          tags: [],
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Büro kapsamı doğrulanamadi.');
  });
});
