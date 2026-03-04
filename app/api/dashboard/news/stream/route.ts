import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { buildDashboardNewsPayload } from '@/lib/news/live-stream';
import type { DashboardCaseLite } from '@/lib/news/types';

const querySchema = z.object({
  limit: z.coerce.number().int().min(10).max(200).default(80),
});

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function loadActiveCases(supabase: any) {
  const withTags = await supabase
    .from('cases')
    .select('id, title, file_no, client_display_name, tags, status')
    .in('status', ['open', 'in_progress'])
    .order('updated_at', { ascending: false })
    .limit(250);

  if (!withTags.error) {
    return ((withTags.data as Array<{
      id: string;
      title: string;
      file_no: string | null;
      client_display_name: string | null;
      tags: string[] | null;
      status: DashboardCaseLite['status'];
    }>) ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      fileNo: item.file_no,
      clientDisplayName: item.client_display_name,
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).toLowerCase()) : [],
      status: item.status,
    }));
  }

  const withoutTags = await supabase
    .from('cases')
    .select('id, title, file_no, client_display_name, status')
    .in('status', ['open', 'in_progress'])
    .order('updated_at', { ascending: false })
    .limit(250);

  if (withoutTags.error) {
    return [] as DashboardCaseLite[];
  }

  return ((withoutTags.data as Array<{
    id: string;
    title: string;
    file_no: string | null;
    client_display_name: string | null;
    status: DashboardCaseLite['status'];
  }>) ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    fileNo: item.file_no,
    clientDisplayName: item.client_display_name,
    tags: [],
    status: item.status,
  }));
}

export async function GET(request: Request) {
  try {
    const access = await requireInternalOfficeUser();
    if (!access.ok) {
      return Response.json({ error: access.message }, { status: access.status });
    }

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      limit: url.searchParams.get('limit') ?? undefined,
    });

    if (!parsed.success) {
      return Response.json({ error: 'Gecersiz sorgu parametresi.' }, { status: 400 });
    }

    const activeCases = await loadActiveCases(access.supabase);
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
