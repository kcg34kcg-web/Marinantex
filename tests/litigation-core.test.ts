import { describe, expect, it } from 'vitest';
import { buildMerkleRoot, computeChainHash } from '@/lib/litigation/merkle';
import { auditChainContinuity } from '@/lib/litigation/chain-audit';
import { buildJurisdictionDiff, getComparedFieldCount } from '@/lib/litigation/jurisdiction';

describe('litigation core utilities', () => {
  it('computes deterministic merkle roots and chain hash values', () => {
    const rootA = buildMerkleRoot(['a', 'b', 'c']);
    const rootB = buildMerkleRoot(['a', 'b', 'c']);
    const rootC = buildMerkleRoot(['a', 'b', 'd']);

    expect(rootA).toBe(rootB);
    expect(rootA).not.toBe(rootC);

    const hashA = computeChainHash({
      caseId: 'case-1',
      stage: 'ocr',
      payloadHash: rootA,
      previousHash: null,
      timestampIso: '2026-02-19T10:00:00.000Z',
    });

    const hashB = computeChainHash({
      caseId: 'case-1',
      stage: 'ocr',
      payloadHash: rootA,
      previousHash: null,
      timestampIso: '2026-02-19T10:00:00.000Z',
    });

    expect(hashA).toBe(hashB);
  });

  it('builds flattened jurisdiction diffs and field counts', () => {
    const left = {
      limitation: {
        baseDays: 365,
        interruptionMultiplier: 2,
      },
      fees: {
        filing: 1200,
      },
    };

    const right = {
      limitation: {
        baseDays: 730,
        interruptionMultiplier: 2,
      },
      fees: {
        filing: 1500,
      },
    };

    const differences = buildJurisdictionDiff(left, right);

    expect(differences).toHaveLength(2);
    expect(differences.map((item) => item.path)).toContain('limitation.baseDays');
    expect(differences.map((item) => item.path)).toContain('fees.filing');
    expect(getComparedFieldCount(left, right)).toBe(3);
  });

  it('audits chain continuity and detects broken links', () => {
    const result = auditChainContinuity([
      {
        stage: 'ocr',
        previousHash: null,
        chainHash: 'hash-1',
        createdAt: '2026-02-19T10:00:00.000Z',
      },
      {
        stage: 'graphing',
        previousHash: 'hash-1',
        chainHash: 'hash-2',
        createdAt: '2026-02-19T10:01:00.000Z',
      },
      {
        stage: 'bundle_export',
        previousHash: 'wrong-hash',
        chainHash: 'hash-3',
        createdAt: '2026-02-19T10:02:00.000Z',
      },
    ]);

    expect(result.validLinkCount).toBe(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.issue).toBe('broken_link');
  });
});
