import { describe, expect, it } from 'vitest';
import { rolloutEnabled } from '@/app/api/rag/_lib/rollout';

describe('rolloutEnabled', () => {
  it('returns false when feature is disabled', () => {
    expect(
      rolloutEnabled({
        flagKey: 'rag_v3_single_pipeline_enforced',
        isEnabled: false,
        rolloutPercentage: 100,
        actorId: 'user-1',
      }),
    ).toBe(false);
  });

  it('returns true for 100 percent rollout when enabled', () => {
    expect(
      rolloutEnabled({
        flagKey: 'rag_v3_single_pipeline_enforced',
        isEnabled: true,
        rolloutPercentage: 100,
        actorId: 'user-1',
      }),
    ).toBe(true);
  });

  it('returns false for zero percent rollout even when enabled', () => {
    expect(
      rolloutEnabled({
        flagKey: 'rag_v3_single_pipeline_enforced',
        isEnabled: true,
        rolloutPercentage: 0,
        actorId: 'user-1',
      }),
    ).toBe(false);
  });

  it('is deterministic for same actor and percentage', () => {
    const a = rolloutEnabled({
      flagKey: 'rag_v3_single_pipeline_enforced',
      isEnabled: true,
      rolloutPercentage: 37,
      actorId: 'stable-user',
    });
    const b = rolloutEnabled({
      flagKey: 'rag_v3_single_pipeline_enforced',
      isEnabled: true,
      rolloutPercentage: 37,
      actorId: 'stable-user',
    });
    expect(a).toBe(b);
  });
});
