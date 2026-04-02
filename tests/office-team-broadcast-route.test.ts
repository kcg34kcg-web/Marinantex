import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  requireInternalOfficeUser: vi.fn(),
  createAdminClient: vi.fn(),
  resolveInternalUserBureauScope: vi.fn(),
  logDashboardAudit: vi.fn(),
  publishOfficeNotification: vi.fn(),
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

vi.mock('@/lib/dashboard/audit', () => ({
  logDashboardAudit: mocked.logDashboardAudit,
}));

vi.mock('@/lib/office/notifications', () => ({
  publishOfficeNotification: mocked.publishOfficeNotification,
}));

import { POST } from '@/app/api/office/team/broadcast/route';

describe('POST /api/office/team/broadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires lawyer role', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'assistant',
      bureauId: 'bureau-1',
      supabase: {},
    });

    const response = await POST(
      new Request('http://localhost/api/office/team/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Duyuru',
          body: 'Ekip duyurusu',
          targetScope: 'all',
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Tum ofis duyurusu icin avukat yetkisi gerekir.');
  });

  it('rejects when bureau scope cannot be resolved', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'lawyer',
      bureauId: 'bureau-1',
      supabase: {},
    });
    mocked.createAdminClient.mockReturnValue({});
    mocked.resolveInternalUserBureauScope.mockResolvedValue(null);

    const response = await POST(
      new Request('http://localhost/api/office/team/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Duyuru',
          body: 'Ekip duyurusu',
          targetScope: 'all',
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Büro kapsamı doğrulanamadı.');
  });
});
