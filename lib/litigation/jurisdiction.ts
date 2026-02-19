import { z } from 'zod';

const jsonObjectSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown());

export const jurisdictionRuleSetSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  config: jsonObjectSchema,
});

export const jurisdictionRuleSetListSchema = z.object({
  items: z.array(jurisdictionRuleSetSchema),
});

export const jurisdictionDiffItemSchema = z.object({
  path: z.string().min(1),
  leftValue: z.unknown(),
  rightValue: z.unknown(),
});

export const jurisdictionDiffResponseSchema = z.object({
  left: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  right: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  comparedFieldCount: z.number().int().nonnegative(),
  differenceCount: z.number().int().nonnegative(),
  differences: z.array(jurisdictionDiffItemSchema),
});

export type JurisdictionRuleSet = z.infer<typeof jurisdictionRuleSetSchema>;
export type JurisdictionRuleSetList = z.infer<typeof jurisdictionRuleSetListSchema>;
export type JurisdictionDiffResponse = z.infer<typeof jurisdictionDiffResponseSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flattenConfig(value: unknown, parentPath = '', output = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenConfig(item, `${parentPath}[${index}]`, output);
    });
    return output;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);

    if (entries.length === 0 && parentPath) {
      output.set(parentPath, value);
      return output;
    }

    entries.forEach(([key, child]) => {
      const nextPath = parentPath ? `${parentPath}.${key}` : key;
      flattenConfig(child, nextPath, output);
    });

    return output;
  }

  if (parentPath) {
    output.set(parentPath, value);
  }

  return output;
}

export function buildJurisdictionDiff(
  leftConfig: Record<string, unknown>,
  rightConfig: Record<string, unknown>,
): Array<{ path: string; leftValue: unknown; rightValue: unknown }> {
  const leftFlat = flattenConfig(leftConfig);
  const rightFlat = flattenConfig(rightConfig);
  const allKeys = new Set([...leftFlat.keys(), ...rightFlat.keys()]);

  const differences = Array.from(allKeys)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((path) => {
      const leftValue = leftFlat.get(path);
      const rightValue = rightFlat.get(path);

      if (JSON.stringify(leftValue) === JSON.stringify(rightValue)) {
        return [];
      }

      return [{ path, leftValue, rightValue }];
    });

  return differences;
}

export function getComparedFieldCount(
  leftConfig: Record<string, unknown>,
  rightConfig: Record<string, unknown>,
): number {
  const leftFlat = flattenConfig(leftConfig);
  const rightFlat = flattenConfig(rightConfig);
  return new Set([...leftFlat.keys(), ...rightFlat.keys()]).size;
}
