import type { AssistantClientDirective } from '@/types/assistant';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function extractClientDirectivesFromToolOutput(output: unknown): AssistantClientDirective[] {
  if (!isRecord(output)) {
    return [];
  }

  const directiveType = output.directiveType;
  const route = output.route;
  if (directiveType === 'NAVIGATE' && typeof route === 'string' && route.startsWith('/')) {
    return [
      {
        type: 'NAVIGATE',
        route,
        reason: typeof output.reason === 'string' ? output.reason : undefined,
      },
    ];
  }

  return [];
}

export function dedupeClientDirectives(directives: AssistantClientDirective[]) {
  const seen = new Set<string>();
  const unique: AssistantClientDirective[] = [];

  for (const directive of directives) {
    const key = `${directive.type}:${directive.route}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(directive);
  }

  return unique;
}
