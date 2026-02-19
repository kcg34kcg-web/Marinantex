import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';

const listCasesQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['all', 'open', 'in_progress', 'closed', 'archived']).default('all'),
  quickView: z.enum(['all', 'open', 'active', 'updated_this_week', 'high_risk']).default('all'),
  sortBy: z.enum(['updated_desc', 'updated_asc', 'title_asc']).default('updated_desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(20),
});

function getQuickViewThreshold(quickView: 'all' | 'open' | 'active' | 'updated_this_week' | 'high_risk') {
  const now = Date.now();

  if (quickView === 'updated_this_week') {
    return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  }

  if (quickView === 'high_risk') {
    return new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const access = await requireInternalOfficeUser();
    if (!access.ok) {
      return Response.json({ error: access.message }, { status: access.status });
    }

    const url = new URL(request.url);
    const parsed = listCasesQuerySchema.safeParse({
      q: url.searchParams.get('q') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      quickView: url.searchParams.get('quickView') ?? undefined,
      sortBy: url.searchParams.get('sortBy') ?? undefined,
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    });

    if (!parsed.success) {
      return Response.json({ error: 'Geçersiz sorgu parametreleri.' }, { status: 400 });
    }

    const { q, status, quickView, sortBy, page, pageSize } = parsed.data;
    const supabase = access.supabase;

    const buildCasesQuery = (includeClientDisplayName: boolean) =>
      supabase
        .from('cases')
        .select(
          includeClientDisplayName
            ? 'id, title, status, updated_at, client_display_name, client:profiles!cases_client_id_fkey(full_name)'
            : 'id, title, status, updated_at, client:profiles!cases_client_id_fkey(full_name)',
          { count: 'exact' }
        );

    let casesQuery = buildCasesQuery(true);

    if (q && q.length > 0) {
      casesQuery = casesQuery.ilike('title', `%${q}%`);
    }

    if (status !== 'all') {
      casesQuery = casesQuery.eq('status', status);
    }

    if (quickView === 'open') {
      casesQuery = casesQuery.eq('status', 'open');
    } else if (quickView === 'active') {
      casesQuery = casesQuery.in('status', ['open', 'in_progress']);
    } else if (quickView === 'updated_this_week') {
      const threshold = getQuickViewThreshold(quickView);
      if (threshold) {
        casesQuery = casesQuery.gte('updated_at', threshold);
      }
    } else if (quickView === 'high_risk') {
      const threshold = getQuickViewThreshold(quickView);
      if (threshold) {
        casesQuery = casesQuery.lt('updated_at', threshold);
      }
    }

    if (sortBy === 'title_asc') {
      casesQuery = casesQuery.order('title', { ascending: true });
    } else if (sortBy === 'updated_asc') {
      casesQuery = casesQuery.order('updated_at', { ascending: true });
    } else {
      casesQuery = casesQuery.order('updated_at', { ascending: false });
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let queryResult: {
      data: unknown[] | null;
      error: { code?: string } | null;
      count: number | null;
    } = (await casesQuery.range(from, to)) as {
      data: unknown[] | null;
      error: { code?: string } | null;
      count: number | null;
    };

    if (queryResult.error?.code === '42703') {
      casesQuery = buildCasesQuery(false);

      if (q && q.length > 0) {
        casesQuery = casesQuery.ilike('title', `%${q}%`);
      }

      if (status !== 'all') {
        casesQuery = casesQuery.eq('status', status);
      }

      if (quickView === 'open') {
        casesQuery = casesQuery.eq('status', 'open');
      } else if (quickView === 'active') {
        casesQuery = casesQuery.in('status', ['open', 'in_progress']);
      } else if (quickView === 'updated_this_week') {
        const threshold = getQuickViewThreshold(quickView);
        if (threshold) {
          casesQuery = casesQuery.gte('updated_at', threshold);
        }
      } else if (quickView === 'high_risk') {
        const threshold = getQuickViewThreshold(quickView);
        if (threshold) {
          casesQuery = casesQuery.lt('updated_at', threshold);
        }
      }

      if (sortBy === 'title_asc') {
        casesQuery = casesQuery.order('title', { ascending: true });
      } else if (sortBy === 'updated_asc') {
        casesQuery = casesQuery.order('updated_at', { ascending: true });
      } else {
        casesQuery = casesQuery.order('updated_at', { ascending: false });
      }

      queryResult = (await casesQuery.range(from, to)) as {
        data: unknown[] | null;
        error: { code?: string } | null;
        count: number | null;
      };
    }

    const { data, error, count } = queryResult;

    if (error) {
      return Response.json({ error: 'Dosya listesi alınamadı.' }, { status: 500 });
    }

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      title: string;
      status: 'open' | 'in_progress' | 'closed' | 'archived';
      updated_at: string;
      client_display_name?: string | null;
      client: { full_name: string | null } | Array<{ full_name: string | null }> | null;
    }>;

    const caseIds = rows.map((item) => item.id);

    const [noteDatesResult, taskDatesResult, openCountResult, inProgressCountResult, closedCountResult, archivedCountResult] =
      await Promise.all([
        caseIds.length
          ? supabase.from('case_updates').select('case_id, created_at').in('case_id', caseIds).order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        caseIds.length
          ? supabase.from('office_tasks').select('case_id, created_at').in('case_id', caseIds).order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        supabase.from('cases').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('cases').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
        supabase.from('cases').select('id', { count: 'exact', head: true }).eq('status', 'closed'),
        supabase.from('cases').select('id', { count: 'exact', head: true }).eq('status', 'archived'),
      ]);

    const noteRows = noteDatesResult.error
      ? ([] as Array<{ case_id: string; created_at: string }>)
      : ((noteDatesResult.data ?? []) as Array<{ case_id: string; created_at: string }>);
    const taskRows = taskDatesResult.error
      ? ([] as Array<{ case_id: string | null; created_at: string }>)
      : ((taskDatesResult.data ?? []) as Array<{ case_id: string | null; created_at: string }>);

    const lastNoteByCaseId = new Map<string, string>();
    noteRows.forEach((item) => {
      if (!lastNoteByCaseId.has(item.case_id)) {
        lastNoteByCaseId.set(item.case_id, item.created_at);
      }
    });

    const lastTaskByCaseId = new Map<string, string>();
    taskRows.forEach((item) => {
      if (!item.case_id) {
        return;
      }

      if (!lastTaskByCaseId.has(item.case_id)) {
        lastTaskByCaseId.set(item.case_id, item.created_at);
      }
    });

    const items = rows.map((item) => {
      const clientSource = Array.isArray(item.client) ? item.client[0] : item.client;

      return {
        id: item.id,
        title: item.title,
        clientName: clientSource?.full_name ?? item.client_display_name ?? 'Atanmamış Müvekkil',
        status: item.status,
        updatedAt: item.updated_at,
        lastNoteAt: lastNoteByCaseId.get(item.id) ?? null,
        lastTaskAt: lastTaskByCaseId.get(item.id) ?? null,
      };
    });

    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return Response.json({
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
      stats: {
        total:
          (openCountResult.count ?? 0) +
          (inProgressCountResult.count ?? 0) +
          (closedCountResult.count ?? 0) +
          (archivedCountResult.count ?? 0),
        open: openCountResult.count ?? 0,
        inProgress: inProgressCountResult.count ?? 0,
        closed: closedCountResult.count ?? 0,
        archived: archivedCountResult.count ?? 0,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Dosya listesi işlenirken beklenmeyen bir hata oluştu.';
    return Response.json({ error: message }, { status: 500 });
  }
}
