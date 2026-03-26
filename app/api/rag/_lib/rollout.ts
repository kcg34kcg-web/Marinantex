export type RolloutFlagKey = string;

export function rolloutEnabled(options: {
  flagKey: RolloutFlagKey;
  isEnabled: boolean;
  rolloutPercentage: number | null | undefined;
  actorId: string;
}): boolean {
  if (!options.isEnabled) return false;
  const pct = Math.max(0, Math.min(100, Math.trunc(Number(options.rolloutPercentage ?? 100))));
  if (pct >= 100) return true;
  if (pct <= 0) return false;

  const seed = `${options.flagKey}:${options.actorId}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  const bucket = Math.abs(hash >>> 0) % 100;
  return bucket < pct;
}
