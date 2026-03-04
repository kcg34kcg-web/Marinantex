type Candidate = {
  created_at?: string;
  woow_count?: number;
  doow_count?: number;
  adil_count?: number;
  comment_count?: number;
  is_following_author?: boolean;
};

export class BabylexitRecommender {
  static calculateScore(candidate: Candidate): number {
    const createdAt = candidate.created_at ? new Date(candidate.created_at).getTime() : Date.now();
    const hoursSince = Math.max((Date.now() - createdAt) / 36e5, 0);

    const engagement =
      (candidate.woow_count ?? 0) * 3 +
      (candidate.adil_count ?? 0) * 2 +
      (candidate.comment_count ?? 0) * 2 -
      (candidate.doow_count ?? 0);

    const recencyBoost = Math.max(48 - hoursSince, 0) / 48;
    const followBoost = candidate.is_following_author ? 1.25 : 1;
    return (engagement + 1) * (1 + recencyBoost) * followBoost;
  }

  static mergeFeeds<T extends { id?: string }>(personal: T[], global: T[], wildcard: T[]): T[] {
    const result: T[] = [];
    const seen = new Set<string>();
    const buckets: T[][] = [personal, global, wildcard];
    const pointers = [0, 0, 0];
    const weights = [3, 2, 1];

    while (result.length < 200) {
      let progressed = false;

      for (let i = 0; i < buckets.length; i += 1) {
        for (let step = 0; step < weights[i]; step += 1) {
          const item = buckets[i][pointers[i]];
          if (!item) break;
          pointers[i] += 1;
          const key = item.id ?? `${i}-${pointers[i]}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push(item);
          progressed = true;
          if (result.length >= 200) break;
        }
        if (result.length >= 200) break;
      }

      if (!progressed) break;
    }

    return result;
  }
}

