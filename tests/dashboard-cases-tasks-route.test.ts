import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  requireInternalOfficeUser: vi.fn(),
  createAdminClient: vi.fn(),
  canAccessCase: vi.fn(),
  resolveInternalUserBureauScope: vi.fn(),
  logDashboardAudit: vi.fn(),
  syncTaskReminderTimelineEvents: vi.fn(),
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

vi.mock('@/lib/dashboard/client-access', () => ({
  resolveInternalUserBureauScope: mocked.resolveInternalUserBureauScope,
}));

vi.mock('@/lib/dashboard/audit', () => ({
  logDashboardAudit: mocked.logDashboardAudit,
}));

vi.mock('@/lib/dashboard/calendar-sync', () => ({
  syncTaskReminderTimelineEvents: mocked.syncTaskReminderTimelineEvents,
}));

import { POST } from '@/app/api/dashboard/cases/tasks/route';

function buildCaseLookupChain(result: unknown) {
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

function buildAssigneeLookupChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(result);
  return chain;
}

describe('POST /api/dashboard/cases/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects assignee outside office scope', async () => {
    mocked.requireInternalOfficeUser.mockResolvedValue({
      ok: true,
      userId: 'actor-user',
      role: 'assistant',
    });
    mocked.canAccessCase.mockResolvedValue(true);
    mocked.resolveInternalUserBureauScope.mockResolvedValue({
      bureauId: 'bureau-1',
      bureauProfileIds: ['actor-user', 'team-user'],
    });

    const caseLookup = buildCaseLookupChain({
      data: { id: '11111111-1111-4111-8111-111111111111', title: 'Case A' },
      error: null,
    });
    const assigneeLookup = buildAssigneeLookupChain({
      data: { id: 'external-user' },
      error: null,
    });
    const admin = {
      from: vi.fn().mockReturnValueOnce(caseLookup).mockReturnValueOnce(assigneeLookup),
    };
    mocked.createAdminClient.mockReturnValue(admin);

    const response = await POST(
      new Request('http://localhost/api/dashboard/cases/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: '11111111-1111-4111-8111-111111111111',
          title: 'Görev',
          assignedTo: '33333333-3333-4333-8333-333333333333',
        }),
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Görev atananı ofis kapsamı dışında.');
  });
});
