import { z } from 'zod';

export const chainAuditItemSchema = z.object({
  index: z.number().int().nonnegative(),
  stage: z.string().min(1),
  issue: z.enum(['broken_link', 'missing_previous_hash']),
  expectedPreviousHash: z.string().nullable(),
  actualPreviousHash: z.string().nullable(),
  chainHash: z.string().min(1),
  createdAt: z.string().min(1),
});

export const chainAuditResponseSchema = z.object({
  caseId: z.string().uuid(),
  totalLogs: z.number().int().nonnegative(),
  validLinkCount: z.number().int().nonnegative(),
  brokenLinkCount: z.number().int().nonnegative(),
  isChainContinuous: z.boolean(),
  issues: z.array(chainAuditItemSchema),
});

export type ChainAuditResponse = z.infer<typeof chainAuditResponseSchema>;

export interface ChainAuditLog {
  stage: string;
  previousHash: string | null;
  chainHash: string;
  createdAt: string;
}

export function auditChainContinuity(logs: ChainAuditLog[]) {
  const issues: Array<{
    index: number;
    stage: string;
    issue: 'broken_link' | 'missing_previous_hash';
    expectedPreviousHash: string | null;
    actualPreviousHash: string | null;
    chainHash: string;
    createdAt: string;
  }> = [];

  let validLinkCount = 0;

  logs.forEach((row, index) => {
    if (index === 0) {
      if (row.previousHash !== null) {
        issues.push({
          index,
          stage: row.stage,
          issue: 'missing_previous_hash',
          expectedPreviousHash: null,
          actualPreviousHash: row.previousHash,
          chainHash: row.chainHash,
          createdAt: row.createdAt,
        });
      } else {
        validLinkCount += 1;
      }

      return;
    }

    const previous = logs[index - 1];
    const expectedPreviousHash = previous.chainHash;

    if (!row.previousHash) {
      issues.push({
        index,
        stage: row.stage,
        issue: 'missing_previous_hash',
        expectedPreviousHash,
        actualPreviousHash: row.previousHash,
        chainHash: row.chainHash,
        createdAt: row.createdAt,
      });
      return;
    }

    if (row.previousHash !== expectedPreviousHash) {
      issues.push({
        index,
        stage: row.stage,
        issue: 'broken_link',
        expectedPreviousHash,
        actualPreviousHash: row.previousHash,
        chainHash: row.chainHash,
        createdAt: row.createdAt,
      });
      return;
    }

    validLinkCount += 1;
  });

  return {
    validLinkCount,
    issues,
  };
}
