function normalize(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => normalize(item));
  }

  if (input !== null && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const sorted: Record<string, unknown> = {};
    for (const key of keys) {
      sorted[key] = normalize(obj[key]);
    }
    return sorted;
  }

  return input;
}

export function stableStringify(input: unknown): string {
  return JSON.stringify(normalize(input));
}
