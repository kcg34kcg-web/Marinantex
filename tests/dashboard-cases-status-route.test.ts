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

import { POST } from '@/app/api/dashboard/cases/status/route';

function buildCaseUpdateChain(result: unknown) {
  const chain = {
    update: vi.fn(),
    in: vi.fn(),
    select: vi.fn(),
  };

  chain.update.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.select.mockResolvedValue(result);

  return chain;
}

describe('POST /api/dashboard/cases/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when at least one selected case is unauthorized', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'assistant',
    });
    mocked.canAccessCase.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const admin = {
      from: vi.fn(),
    };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(
      new Request('http://localhost/api/dashboard/cases/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
          status: 'closed',
        }),
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Seçilen dosyalardan en az birine erişim yetkiniz yok.');
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('updates only unique case ids and returns updated count on success', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'lawyer',
    });
    mocked.canAccessCase.mockResolvedValue(true);

    const updateChain = buildCaseUpdateChain({
      data: [{ id: '11111111-1111-4111-8111-111111111111' }],
      error: null,
    });
    const timelineInsert = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const admin = {
      from: vi.fn().mockReturnValueOnce(updateChain).mockReturnValueOnce(timelineInsert),
    };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(
      new Request('http://localhost/api/dashboard/cases/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseIds: ['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'],
          status: 'in_progress',
        }),
      })
    );
    const payload = (await response.json()) as { updatedCount?: number };

    expect(response.status).toBe(200);
    expect(payload.updatedCount).toBe(1);
    expect(updateChain.in).toHaveBeenCalledWith('id', ['11111111-1111-4111-8111-111111111111']);
    expect(mocked.logDashboardAudit).toHaveBeenCalled();
  });
});
