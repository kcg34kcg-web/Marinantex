import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  requireInternalOfficeUser: vi.fn(),
  createAdminClient: vi.fn(),
  logDashboardAudit: vi.fn(),
  publishOfficeNotification: vi.fn(),
}));

vi.mock('@/lib/office/team-access', () => ({
  requireInternalOfficeUser: mocked.requireInternalOfficeUser,
}));

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: mocked.createAdminClient,
}));

vi.mock('@/lib/dashboard/audit', () => ({
  logDashboardAudit: mocked.logDashboardAudit,
}));

vi.mock('@/lib/office/notifications', () => ({
  publishOfficeNotification: mocked.publishOfficeNotification,
}));

import { GET, POST } from '@/app/api/office/team/messages/route';

function buildMembershipLookup(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(result);
  return chain;
}

describe('/api/office/team/messages membership checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET rejects users without thread membership', async () => {
    const membershipLookup = buildMembershipLookup({ data: null, error: null });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'office_thread_members') return membershipLookup;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'assistant',
      bureauId: 'bureau-1',
      supabase,
    });

    const response = await GET(
      new Request(
        'http://localhost/api/office/team/messages?threadId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Bu sohbeti goruntuleme yetkiniz yok.');
  });

  it('POST rejects users without thread membership', async () => {
    const membershipLookup = buildMembershipLookup({ data: null, error: null });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'office_thread_members') return membershipLookup;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'assistant',
      bureauId: 'bureau-1',
      supabase,
    });

    const response = await POST(
      new Request('http://localhost/api/office/team/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          body: 'Merhaba ekip',
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Bu sohbete mesaj gonderme yetkiniz yok.');
  });
});
