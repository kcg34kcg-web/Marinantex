import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  requireInternalOfficeUser: vi.fn(),
  createAdminClient: vi.fn(),
  resolveInternalUserBureauScope: vi.fn(),
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

vi.mock('@/lib/office/notifications', () => ({
  publishOfficeNotification: mocked.publishOfficeNotification,
}));

import { GET, POST } from '@/app/api/office/team/tasks/route';

function buildLookupChain(result: { data: unknown; error: unknown }) {
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

describe('/api/office/team/tasks scope checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns empty list when user is not a member of any thread', async () => {
    const membershipChain = {
      select: vi.fn(),
      eq: vi.fn(),
    };
    membershipChain.select.mockReturnValue(membershipChain);
    membershipChain.eq.mockResolvedValue({ data: [], error: null });

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'office_thread_members') return membershipChain;
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

    const response = await GET();
    const payload = (await response.json()) as { tasks?: unknown[] };

    expect(response.status).toBe(200);
    expect(payload.tasks).toEqual([]);
  });

  it('POST rejects assignee outside office scope', async () => {
    const membershipLookup = buildLookupChain({
      data: { thread_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      error: null,
    });
    const messageLookup = buildLookupChain({
      data: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      error: null,
    });

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'office_thread_members') return membershipLookup;
        if (table === 'office_messages') return messageLookup;
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
    mocked.createAdminClient.mockReturnValue({});
    mocked.resolveInternalUserBureauScope.mockResolvedValue({
      bureauId: 'bureau-1',
      bureauProfileIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
    });

    const response = await POST(
      new Request('http://localhost/api/office/team/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          threadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          title: 'Takip görevi',
          assignedTo: '33333333-3333-4333-8333-333333333333',
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Görev atananı ofis kapsamı dışında.');
  });
});
