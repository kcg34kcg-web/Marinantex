import { z } from 'zod';
import { buildDashboardNewsPayload } from '@/lib/news/live-stream';
import type { DashboardCaseLite } from '@/lib/news/types';
import { createClient } from '@/utils/supabase/server';

const querySchema = z.object({
  limit: z.coerce.number().int().min(10).max(200).default(80),
});

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizeCaseTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

async function loadActiveCasesForCurrentUser(): Promise<DashboardCaseLite[]> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return [];
    }

    const result = await supabase
      .from('cases')
      .select('id, title, file_no, client_display_name, tags, status, updated_at')
      .in('status', ['open', 'in_progress'])
      .order('updated_at', { ascending: false })
      .limit(180);

    if (result.error || !result.data) {
      return [];
    }

    return result.data
      .map((row) => ({
        id: row.id,
        title: row.title,
        fileNo: row.file_no ?? null,
        clientDisplayName: row.client_display_name ?? null,
        tags: normalizeCaseTags(row.tags),
        status: row.status as DashboardCaseLite['status'],
      }))
      .filter((row) => row.id.length > 0 && row.title.length > 0);
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      limit: url.searchParams.get('limit') ?? undefined,
    });

    if (!parsed.success) {
      return Response.json({ error: 'Gecersiz sorgu parametresi.' }, { status: 400 });
    }

    const activeCases = await loadActiveCasesForCurrentUser();
    const payload = await buildDashboardNewsPayload({
      activeCases,
      limit: parsed.data.limit,
    });

    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Haber akisi olusturulamadi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
