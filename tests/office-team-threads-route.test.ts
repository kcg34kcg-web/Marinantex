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

import { POST } from '@/app/api/office/team/threads/route';

describe('POST /api/office/team/threads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects broadcast thread creation from threads endpoint', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'lawyer',
      bureauId: 'bureau-1',
      supabase: {},
    });

    const response = await POST(
      new Request('http://localhost/api/office/team/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadType: 'broadcast',
          title: 'Ofis duyurusu',
          initialMessage: 'Merhaba ekip',
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Duyurular için broadcast endpointi kullanılmalıdır.');
  });

  it('rejects members outside office scope', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'assistant',
      bureauId: 'bureau-1',
      supabase: {},
    });
    mocked.createAdminClient.mockReturnValue({});
    mocked.resolveInternalUserBureauScope.mockResolvedValue({
      bureauId: 'bureau-1',
      bureauProfileIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
    });

    const response = await POST(
      new Request('http://localhost/api/office/team/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadType: 'direct',
          memberIds: ['33333333-3333-4333-8333-333333333333'],
          initialMessage: 'Selam',
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Seçilen üyeler ofis kapsamı dışında.');
  });
});
