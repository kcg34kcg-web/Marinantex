import type { ContradictionCandidate } from '@/lib/litigation/types';

export interface CandidateStatement {
  id: string;
  text: string;
  vector: number[];
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function filterBySemanticSimilarity(
  statements: CandidateStatement[],
  threshold = 0.82
): ContradictionCandidate[] {
  const candidates: ContradictionCandidate[] = [];

  for (let leftIndex = 0; leftIndex < statements.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < statements.length; rightIndex += 1) {
      const score = cosineSimilarity(statements[leftIndex].vector, statements[rightIndex].vector);

      if (score < threshold) {
        continue;
      }

      candidates.push({
        leftStatementId: statements[leftIndex].id,
        rightStatementId: statements[rightIndex].id,
        semanticSimilarity: score.toFixed(4),
      });
    }
  }

  return candidates;
}
