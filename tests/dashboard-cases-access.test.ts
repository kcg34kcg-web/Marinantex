import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  resolveInternalUserBureauScope: vi.fn(),
}));

vi.mock('@/lib/dashboard/client-access', () => ({
  resolveInternalUserBureauScope: mocked.resolveInternalUserBureauScope,
}));

import { canAccessCase } from '@/lib/dashboard/access';

function buildCaseQueryChain(result: unknown) {
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

describe('canAccessCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows lawyer only for own case', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue(
        buildCaseQueryChain({
          data: { id: 'case-1', lawyer_id: 'lawyer-1', bureau_id: 'bureau-1' },
          error: null,
        })
      ),
    };

    await expect(
      canAccessCase(supabase as never, {
        caseId: 'case-1',
        userId: 'lawyer-1',
        role: 'lawyer',
      })
    ).resolves.toBe(true);

    await expect(
      canAccessCase(supabase as never, {
        caseId: 'case-1',
        userId: 'lawyer-2',
        role: 'lawyer',
      })
    ).resolves.toBe(false);
  });

  it('allows assistant only inside own bureau when bureau_id exists', async () => {
    mocked.resolveInternalUserBureauScope.mockResolvedValue({
      bureauId: 'bureau-1',
      bureauProfileIds: ['lawyer-1', 'assistant-1'],
    });

    const supabase = {
      from: vi.fn().mockReturnValue(
        buildCaseQueryChain({
          data: { id: 'case-1', lawyer_id: 'lawyer-1', bureau_id: 'bureau-1' },
          error: null,
        })
      ),
    };

    await expect(
      canAccessCase(supabase as never, {
        caseId: 'case-1',
        userId: 'assistant-1',
        role: 'assistant',
      })
    ).resolves.toBe(true);

    mocked.resolveInternalUserBureauScope.mockResolvedValueOnce({
      bureauId: 'bureau-2',
      bureauProfileIds: ['assistant-2'],
    });

    await expect(
      canAccessCase(supabase as never, {
        caseId: 'case-1',
        userId: 'assistant-2',
        role: 'assistant',
      })
    ).resolves.toBe(false);
  });

  it('falls back to lawyer scope check when bureau_id column is unavailable', async () => {
    mocked.resolveInternalUserBureauScope.mockResolvedValue({
      bureauId: 'bureau-1',
      bureauProfileIds: ['lawyer-1', 'assistant-1'],
    });

    const firstQuery = buildCaseQueryChain({
      data: null,
      error: { code: '42703' },
    });
    const secondQuery = buildCaseQueryChain({
      data: { id: 'case-1', lawyer_id: 'lawyer-1' },
      error: null,
    });
    const supabase = {
      from: vi.fn().mockReturnValueOnce(firstQuery).mockReturnValueOnce(secondQuery),
    };

    await expect(
      canAccessCase(supabase as never, {
        caseId: 'case-1',
        userId: 'assistant-1',
        role: 'assistant',
      })
    ).resolves.toBe(true);
  });
});
