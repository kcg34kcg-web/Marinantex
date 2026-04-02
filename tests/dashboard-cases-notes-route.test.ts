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

import { GET, POST } from '@/app/api/dashboard/cases/notes/route';

describe('/api/dashboard/cases/notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns 400 for invalid caseId query', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'assistant',
    });

    const response = await GET(new Request('http://localhost/api/dashboard/cases/notes?caseId=invalid'));
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Geçersiz caseId.');
  });

  it('POST returns 403 when case access is denied', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'assistant',
    });
    mocked.canAccessCase.mockResolvedValue(false);

    const admin = { from: vi.fn() };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(
      new Request('http://localhost/api/dashboard/cases/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: '11111111-1111-4111-8111-111111111111',
          message: 'Kısa not',
          isPublicToClient: false,
        }),
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Bu dosyada not ekleme yetkiniz yok.');
    expect(admin.from).not.toHaveBeenCalled();
  });
});
