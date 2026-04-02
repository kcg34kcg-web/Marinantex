import { describe, expect, it } from 'vitest';
import { dedupeClientDirectives, extractClientDirectivesFromToolOutput } from '@/lib/assistant/client-directives';

describe('assistant client directives', () => {
  it('extracts navigation directives from tool output', () => {
    const directives = extractClientDirectivesFromToolOutput({
      directiveType: 'NAVIGATE',
      route: '/dashboard/mail',
      reason: 'test',
    });

    expect(directives).toEqual([
      {
        type: 'NAVIGATE',
        route: '/dashboard/mail',
        reason: 'test',
      },
    ]);
  });

  it('deduplicates directives by route and type', () => {
    const unique = dedupeClientDirectives([
      { type: 'NAVIGATE', route: '/dashboard/mail' },
      { type: 'NAVIGATE', route: '/dashboard/mail' },
      { type: 'NAVIGATE', route: '/dashboard/tasks' },
    ]);

    expect(unique).toEqual([
      { type: 'NAVIGATE', route: '/dashboard/mail' },
      { type: 'NAVIGATE', route: '/dashboard/tasks' },
    ]);
  });
});
