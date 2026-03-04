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

function includesSearch(haystack: string, query?: string) {
  if (!query || query.length === 0) {
    return true;
  }

  return haystack.toLowerCase().includes(query.toLowerCase());
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

    let casesQuery = supabase
      .from('cases')
      .select('id, title, status, updated_at, file_no, client_display_name', { count: 'exact' });

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
    const shouldUseWideRange = Boolean(q && q.trim().length > 0);
    const queryResult = shouldUseWideRange
      ? await casesQuery.range(0, 399)
      : await casesQuery.range(from, to);

    if (queryResult.error) {
      return Response.json({ error: 'Dosya listesi alinamadi.' }, { status: 500 });
    }

    const rows = (queryResult.data ?? []) as Array<{
      id: string;
      title: string;
      status: 'open' | 'in_progress' | 'closed' | 'archived';
      updated_at: string;
      file_no: string | null;
      client_display_name: string | null;
    }>;

    const caseIds = rows.map((item) => item.id);

    const [noteDatesResult, taskDatesResult, caseClientsResult, openCountResult, inProgressCountResult, closedCountResult, archivedCountResult] =
      await Promise.all([
        caseIds.length
          ? supabase.from('case_updates').select('case_id, created_at').in('case_id', caseIds).order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        caseIds.length
          ? supabase.from('office_tasks').select('case_id, created_at').in('case_id', caseIds).order('created_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        caseIds.length
          ? supabase
              .from('case_clients')
              .select('case_id, client_id, public_ref_code')
              .in('case_id', caseIds)
              .is('deleted_at', null)
          : Promise.resolve({ data: [], error: null }),
        supabase.from('cases').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('cases').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
        supabase.from('cases').select('id', { count: 'exact', head: true }).eq('status', 'closed'),
        supabase.from('cases').select('id', { count: 'exact', head: true }).eq('status', 'archived'),
      ]);

    if (caseClientsResult.error && caseClientsResult.error.code !== '42P01') {
      return Response.json({ error: 'Dosya-müvekkil iliskileri alinamadi.' }, { status: 500 });
    }

    const caseClientRows = (caseClientsResult.data ?? []) as Array<{
      case_id: string;
      client_id: string;
      public_ref_code: string;
    }>;

    const clientIds = [...new Set(caseClientRows.map((item) => item.client_id))];

    const clientsResult = clientIds.length
      ? await supabase
          .from('clients')
          .select('id, full_name, public_ref_code, file_no')
          .in('id', clientIds)
          .is('deleted_at', null)
      : { data: [], error: null };

    if (clientsResult.error && clientsResult.error.code !== '42P01') {
      return Response.json({ error: 'Müvekkil verileri alinamadi.' }, { status: 500 });
    }

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

    const clientsById = new Map(
      ((clientsResult.data ?? []) as Array<{ id: string; full_name: string; public_ref_code: string; file_no: string | null }>).map((item) => [
        item.id,
        {
          id: item.id,
          fullName: item.full_name,
          publicRefCode: item.public_ref_code,
          fileNo: item.file_no,
        },
      ])
    );

    const linksByCaseId = new Map<string, Array<{ id: string; fullName: string; publicRefCode: string; fileNo: string | null; relationRefCode: string }>>();

    caseClientRows.forEach((item) => {
      const client = clientsById.get(item.client_id);
      if (!client) {
        return;
      }

      const current = linksByCaseId.get(item.case_id) ?? [];
      current.push({
        ...client,
        relationRefCode: item.public_ref_code,
      });
      linksByCaseId.set(item.case_id, current);
    });

    const preFilteredItems = rows.map((item) => {
      const linkedClients = linksByCaseId.get(item.id) ?? [];
      const displayName =
        linkedClients.length > 0
          ? linkedClients.map((client) => client.fullName).join(', ')
          : item.client_display_name ?? 'Atanmamis Müvekkil';

      return {
        id: item.id,
        title: item.title,
        clientName: displayName,
        clients: linkedClients,
        fileNo: item.file_no,
        status: item.status,
        updatedAt: item.updated_at,
        lastNoteAt: lastNoteByCaseId.get(item.id) ?? null,
        lastTaskAt: lastTaskByCaseId.get(item.id) ?? null,
      };
    });

    const searchedItems = preFilteredItems.filter((item) => {
      const searchSource = [
        item.title,
        item.clientName,
        item.fileNo ?? '',
        ...item.clients.map((client) => client.publicRefCode),
        ...item.clients.map((client) => client.relationRefCode),
      ].join(' ');

      return includesSearch(searchSource, q);
    });

    const pagedItems = shouldUseWideRange ? searchedItems.slice(from, from + pageSize) : searchedItems;
    const total = shouldUseWideRange ? searchedItems.length : (queryResult.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return Response.json({
      items: pagedItems,
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
    const message = error instanceof Error ? error.message : 'Dosya listesi islenirken beklenmeyen bir hata olustu.';
    return Response.json({ error: message }, { status: 500 });
  }
}

