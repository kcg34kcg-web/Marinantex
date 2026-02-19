import { createHash } from 'node:crypto';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function buildMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) {
    return sha256('');
  }

  let level = leaves.map((item) => sha256(item));

  while (level.length > 1) {
    const nextLevel: string[] = [];

    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      nextLevel.push(sha256(`${left}${right}`));
    }

    level = nextLevel;
  }

  return level[0];
}

export interface ChainOfCustodyInput {
  caseId: string;
  stage: 'ocr' | 'extraction' | 'graphing' | 'bundle_export';
  payloadHash: string;
  previousHash: string | null;
  timestampIso: string;
}

export function computeChainHash(input: ChainOfCustodyInput): string {
  return sha256(
    [
      input.caseId,
      input.stage,
      input.payloadHash,
      input.previousHash ?? 'GENESIS',
      input.timestampIso,
    ].join('|')
  );
}
