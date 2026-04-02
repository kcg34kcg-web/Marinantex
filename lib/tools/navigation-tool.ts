import type { AssistantTool, ToolExecutionInput } from '@/lib/tools/types';

const DIRECT_ROUTES = new Set<string>([
  '/',
  '/dashboard',
  '/dashboard/mail',
  '/dashboard/tasks',
  '/dashboard/calendar',
  '/dashboard/cases',
  '/dashboard/clients',
  '/dashboard/news',
  '/dashboard/profile',
  '/dashboard/settings',
  '/dashboard/time-billing',
  '/dashboard/invites',
  '/dashboard/corpus',
  '/tools/hukuk-ai',
  '/tools/kaynak-ictihat-arama',
  '/tools/dilekce-sihirbazi',
  '/tools/calculator/execution',
  '/tools/calculator/interest',
  '/tools/calculator/smm',
  '/office',
  '/messages',
  '/portal',
  '/social',
  '/lounge',
  '/editor',
]);

const ROUTE_PREFIXES = [/^\/dashboard\/cases\/[^/]+$/, /^\/dashboard\/clients\/[^/]+$/, /^\/messages\/[^/]+$/, /^\/editor\/[^/]+$/];

function normalizeRoute(inputRoute: string) {
  if (!inputRoute || !inputRoute.startsWith('/')) {
    return null;
  }

  if (inputRoute.startsWith('//')) {
    return null;
  }

  const parsed = new URL(inputRoute, 'https://babylexit.local');
  const pathname = parsed.pathname;

  const isAllowed = DIRECT_ROUTES.has(pathname) || ROUTE_PREFIXES.some((pattern) => pattern.test(pathname));
  if (!isAllowed) {
    return null;
  }

  const query = parsed.searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function routeFromParams(params: Record<string, unknown>) {
  const raw = typeof params.route === 'string' ? params.route.trim() : '';
  const normalized = normalizeRoute(raw);
  if (normalized) {
    return normalized;
  }
  return '/dashboard';
}

function buildSummary(route: string) {
  return `${route} sayfası açılıyor.`;
}

export const appNavigateTool: AssistantTool = {
  name: 'app.navigate',
  label: 'Sayfa Aç',
  description: 'Uygulama içinde güvenli rota yönlendirmesi yapar.',
  requiresConfirmation: false,
  async preview(input: ToolExecutionInput) {
    const route = routeFromParams(input.params);
    return {
      summary: buildSummary(route),
      preview: {
        directiveType: 'NAVIGATE',
        route,
      },
      requiresConfirmation: false,
    };
  },
  async run(input: ToolExecutionInput) {
    const route = routeFromParams(input.params);
    return {
      summary: buildSummary(route),
      output: {
        directiveType: 'NAVIGATE',
        route,
        reason: typeof input.params.reason === 'string' ? input.params.reason : 'assistant_navigation',
      },
    };
  },
};
