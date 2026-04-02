import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  requireInternalOfficeUser: vi.fn(),
  createAdminClient: vi.fn(),
  resolveInternalUserBureauScope: vi.fn(),
}));

vi.mock('@/lib/office/team-access', () => ({
  requireInternalOfficeUser: mocked.requireInternalOfficeUser,
}));

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: mocked.createAdminClient,
}));

vi.mock('@/lib/dashboard/client-access', () => ({
  resolveInternalUserBureauScope: mocked.resolveInternalUserBureauScope,
}));

import { GET } from '@/app/api/dashboard/cases/list/route';

describe('GET /api/dashboard/cases/list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result for assistant when bureau scope is missing', async () => {
    const supabase = {
      from: vi.fn(),
    };

    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'assistant-user',
      role: 'assistant',
      supabase,
    });
    mocked.createAdminClient.mockReturnValue({});
    mocked.resolveInternalUserBureauScope.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost/api/dashboard/cases/list?page=1&pageSize=20'));
    const payload = (await response.json()) as {
      items?: unknown[];
      pagination?: { total?: number };
      stats?: { total?: number };
    };

    expect(response.status).toBe(200);
    expect(payload.items).toEqual([]);
    expect(payload.pagination?.total).toBe(0);
    expect(payload.stats?.total).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns empty result for assistant when bureau profile list is empty', async () => {
    const supabase = {
      from: vi.fn(),
    };

    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'assistant-user',
      role: 'assistant',
      supabase,
    });
    mocked.createAdminClient.mockReturnValue({});
    mocked.resolveInternalUserBureauScope.mockResolvedValue({
      bureauId: 'bureau-1',
      bureauProfileIds: [],
    });

    const response = await GET(new Request('http://localhost/api/dashboard/cases/list?page=1&pageSize=20'));
    const payload = (await response.json()) as {
      items?: unknown[];
      pagination?: { total?: number };
      stats?: { total?: number };
    };

    expect(response.status).toBe(200);
    expect(payload.items).toEqual([]);
    expect(payload.pagination?.total).toBe(0);
    expect(payload.stats?.total).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
