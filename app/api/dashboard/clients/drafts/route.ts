import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { createAdminClient } from '@/utils/supabase/admin';
import { requireInternalOfficeUser } from '@/lib/office/team-access';

const statusSchema = z.enum(['draft', 'approved', 'archived']);

const listQuerySchema = z.object({
  status: statusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

const updateSchema = z.object({
  draftId: z.string().uuid(),
  status: statusSchema,
  note: z.string().trim().max(500).optional(),
});

type InternalRole = 'lawyer' | 'assistant';

interface ClientDraftRow {
  id: string;
  user_id: string;
  case_id: string | null;
  client_id: string | null;
  source_message_id: string | null;
  source_saved_output_id: string | null;
  action: 'translate_for_client_draft' | 'save_client_draft';
  status: 'draft' | 'approved' | 'archived';
  title: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

async function resolveBureauId(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const context = await resolveBureauContext(supabase).catch(() => null);
  if (context?.userId === userId && context.bureauId) {
    return context.bureauId;
  }
  const admin = createAdminClient();
  const { data, error } = await admin.from('profiles').select('bureau_id').eq('id', userId).maybeSingle();
  if (error || !data?.bureau_id) return null;
  return data.bureau_id;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function mapDraft(
  row: ClientDraftRow,
  userNameById: Map<string, string>,
  clientNameById: Map<string, string>,
  caseTitleById: Map<string, string>,
) {
  return {
    id: row.id,
    action: row.action,
    status: row.status,
    title: row.title,
    content: row.content,
    contentPreview: row.content.slice(0, 380),
    caseId: row.case_id,
    caseTitle: row.case_id ? (caseTitleById.get(row.case_id) ?? null) : null,
    clientId: row.client_id,
    clientName: row.client_id ? (clientNameById.get(row.client_id) ?? null) : null,
    ownerUserId: row.user_id,
    ownerName: userNameById.get(row.user_id) ?? null,
    sourceMessageId: row.source_message_id,
    sourceSavedOutputId: row.source_saved_output_id,
    metadata: asObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  try {
    const access = await requireInternalOfficeUser();
    if (!access.ok) {
      return Response.json({ error: access.message }, { status: access.status });
    }

    const url = new URL(request.url);
    const parsedQuery = listQuerySchema.safeParse({
      status: url.searchParams.get('status') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!parsedQuery.success) {
      return Response.json({ error: 'Gecersiz draft sorgusu.' }, { status: 400 });
    }

    const bureauId = await resolveBureauId(access.userId);
    if (!bureauId) {
      return Response.json({ error: 'Buro baglami bulunamadi.' }, { status: 401 });
    }

    const admin = createAdminClient();
    let draftQuery = admin
      .from('client_messages')
      .select(
        'id, user_id, case_id, client_id, source_message_id, source_saved_output_id, action, status, title, content, metadata, created_at, updated_at',
      )
      .eq('bureau_id', bureauId)
      .order('created_at', { ascending: false })
      .limit(parsedQuery.data.limit);

    if (parsedQuery.data.status) {
      draftQuery = draftQuery.eq('status', parsedQuery.data.status);
    }
    if (access.role !== 'lawyer') {
      draftQuery = draftQuery.eq('user_id', access.userId);
    }

    const { data: draftsData, error: draftsError } = await draftQuery;
    if (draftsError) {
      return Response.json({ error: 'Muvekkil taslaklari okunamadi.' }, { status: 500 });
    }

    const draftRows = (draftsData ?? []) as ClientDraftRow[];
    const ownerIds = [...new Set(draftRows.map((row) => row.user_id))];
    const clientIds = [...new Set(draftRows.map((row) => row.client_id).filter((id): id is string => Boolean(id)))];
    const caseIds = [...new Set(draftRows.map((row) => row.case_id).filter((id): id is string => Boolean(id)))];

    const [ownerResult, clientResult, caseResult] = await Promise.all([
      ownerIds.length > 0
        ? admin.from('profiles').select('id, full_name').in('id', ownerIds)
        : Promise.resolve({ data: [], error: null }),
      clientIds.length > 0
        ? admin.from('profiles').select('id, full_name').in('id', clientIds)
        : Promise.resolve({ data: [], error: null }),
      caseIds.length > 0
        ? admin.from('cases').select('id, title').in('id', caseIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (ownerResult.error || clientResult.error || caseResult.error) {
      return Response.json({ error: 'Taslak iliski verileri okunamadi.' }, { status: 500 });
    }

    const ownerNameById = new Map<string, string>();
    for (const item of ownerResult.data ?? []) {
      ownerNameById.set(item.id, item.full_name ?? 'Ofis Kullanici');
    }
    const clientNameById = new Map<string, string>();
    for (const item of clientResult.data ?? []) {
      clientNameById.set(item.id, item.full_name ?? 'Muvekkil');
    }
    const caseTitleById = new Map<string, string>();
    for (const item of caseResult.data ?? []) {
      caseTitleById.set(item.id, item.title ?? 'Case');
    }

    const mappedDrafts = draftRows.map((row) => mapDraft(row, ownerNameById, clientNameById, caseTitleById));
    const summary = {
      total: mappedDrafts.length,
      draft: mappedDrafts.filter((item) => item.status === 'draft').length,
      approved: mappedDrafts.filter((item) => item.status === 'approved').length,
      archived: mappedDrafts.filter((item) => item.status === 'archived').length,
    };

    return Response.json({
      viewerRole: access.role,
      drafts: mappedDrafts,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Muvekkil taslaklari alinmadi.';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await requireInternalOfficeUser();
    if (!access.ok) {
      return Response.json({ error: access.message }, { status: access.status });
    }

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: 'Gecersiz draft guncelleme payload.' }, { status: 400 });
    }

    if (parsed.data.status === 'approved' && access.role !== 'lawyer') {
      return Response.json(
        { error: 'Muvekkil taslagini sadece avukat role sahip kullanici onaylayabilir.' },
        { status: 403 },
      );
    }

    const bureauId = await resolveBureauId(access.userId);
    if (!bureauId) {
      return Response.json({ error: 'Buro baglami bulunamadi.' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: existingDraft, error: existingError } = await admin
      .from('client_messages')
      .select('id, bureau_id, user_id, status, metadata')
      .eq('id', parsed.data.draftId)
      .maybeSingle();

    if (existingError) {
      return Response.json({ error: 'Taslak bulunamadi.' }, { status: 404 });
    }
    if (!existingDraft || existingDraft.bureau_id !== bureauId) {
      return Response.json({ error: 'Taslak bulunamadi veya bu buroya ait degil.' }, { status: 404 });
    }
    if (access.role !== 'lawyer' && existingDraft.user_id !== access.userId) {
      return Response.json({ error: 'Bu taslagi guncelleme yetkiniz yok.' }, { status: 403 });
    }

    const nowIso = new Date().toISOString();
    const metadata = asObject(existingDraft.metadata);
    if (parsed.data.status === 'approved') {
      metadata.approval = {
        approved_by_user_id: access.userId,
        approved_at: nowIso,
        note: parsed.data.note ?? null,
      };
    } else if (parsed.data.status === 'archived') {
      metadata.archive = {
        archived_by_user_id: access.userId,
        archived_at: nowIso,
        note: parsed.data.note ?? null,
      };
    } else {
      metadata.reopen = {
        reopened_by_user_id: access.userId,
        reopened_at: nowIso,
        note: parsed.data.note ?? null,
      };
    }

    const { data: updatedDraft, error: updateError } = await admin
      .from('client_messages')
      .update({
        status: parsed.data.status,
        metadata,
      })
      .eq('id', parsed.data.draftId)
      .eq('bureau_id', bureauId)
      .select(
        'id, user_id, case_id, client_id, source_message_id, source_saved_output_id, action, status, title, content, metadata, created_at, updated_at',
      )
      .single();

    if (updateError || !updatedDraft) {
      return Response.json({ error: 'Taslak durumu guncellenemedi.' }, { status: 500 });
    }

    return Response.json({
      updated: {
        id: updatedDraft.id,
        status: updatedDraft.status,
        updatedAt: updatedDraft.updated_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Taslak guncellenemedi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
