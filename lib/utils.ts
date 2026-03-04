export type ClassValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, boolean | null | undefined>
  | ClassValue[];

function normalizeClassValue(value: ClassValue, output: string[]): void {
  if (!value) {
    return;
  }

  if (typeof value === "string" || typeof value === "number") {
    output.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      normalizeClassValue(item, output);
    }
    return;
  }

  if (typeof value === "object") {
    for (const [key, enabled] of Object.entries(value)) {
      if (enabled) {
        output.push(key);
      }
    }
  }
}

export function cn(...inputs: ClassValue[]): string {
  const output: string[] = [];

  for (const input of inputs) {
    normalizeClassValue(input, output);
  }

  return output.join(" ").trim();
}
