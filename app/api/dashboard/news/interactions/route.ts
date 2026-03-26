import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';

const MAX_NEWS_IDS_PER_REQUEST = 200;

const postSchema = z.object({
  newsId: z.string().min(3).max(180),
  action: z.enum(['mark_read', 'mark_unread', 'mark_saved', 'mark_unsaved', 'mark_shared']),
});

type InteractionState = {
  isRead: boolean;
  isSaved: boolean;
  shareCount: number;
  lastSharedAt: string | null;
  updatedAt: string | null;
};

function emptyState(): InteractionState {
  return {
    isRead: false,
    isSaved: false,
    shareCount: 0,
    lastSharedAt: null,
    updatedAt: null,
  };
}

function parseNewsIds(raw: string | null) {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, MAX_NEWS_IDS_PER_REQUEST);
}

export async function GET(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const url = new URL(request.url);
  const ids = parseNewsIds(url.searchParams.get('ids'));

  if (ids.length === 0) {
    return Response.json({ states: {} });
  }

  const { data, error } = await access.supabase
    .from('office_news_interactions')
    .select('news_id, is_read, is_saved, share_count, last_shared_at, updated_at')
    .eq('user_id', access.userId)
    .in('news_id', ids);

  if (error) {
    return Response.json(
      { error: 'Haber etkileşimleri okunamadı. News interaction migrationı uygulanmalı.' },
      { status: 500 },
    );
  }

  const states: Record<string, InteractionState> = {};
  ids.forEach((id) => {
    states[id] = emptyState();
  });

  (data ?? []).forEach((row) => {
    states[row.news_id] = {
      isRead: row.is_read ?? false,
      isSaved: row.is_saved ?? false,
      shareCount: Number.isFinite(row.share_count) ? row.share_count : 0,
      lastSharedAt: row.last_shared_at ?? null,
      updatedAt: row.updated_at ?? null,
    };
  });

  return Response.json({ states });
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = postSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz etkileşim verisi.' }, { status: 400 });
  }

  const payload = parsed.data;

  const existingResult = await access.supabase
    .from('office_news_interactions')
    .select('is_read, is_saved, share_count, last_shared_at')
    .eq('user_id', access.userId)
    .eq('news_id', payload.newsId)
    .maybeSingle();

  if (existingResult.error) {
    return Response.json({ error: 'Mevcut etkileşim bilgisi okunamadı.' }, { status: 500 });
  }

  const previous = existingResult.data;
  let nextIsRead = previous?.is_read ?? false;
  let nextIsSaved = previous?.is_saved ?? false;
  let nextShareCount = previous?.share_count ?? 0;
  let nextLastSharedAt = previous?.last_shared_at ?? null;

  if (payload.action === 'mark_read') {
    nextIsRead = true;
  } else if (payload.action === 'mark_unread') {
    nextIsRead = false;
  } else if (payload.action === 'mark_saved') {
    nextIsSaved = true;
  } else if (payload.action === 'mark_unsaved') {
    nextIsSaved = false;
  } else if (payload.action === 'mark_shared') {
    nextIsRead = true;
    nextShareCount += 1;
    nextLastSharedAt = new Date().toISOString();
  }

  const upsertResult = await access.supabase
    .from('office_news_interactions')
    .upsert(
      {
        user_id: access.userId,
        news_id: payload.newsId,
        is_read: nextIsRead,
        is_saved: nextIsSaved,
        share_count: nextShareCount,
        last_shared_at: nextLastSharedAt,
      },
      { onConflict: 'user_id,news_id' },
    )
    .select('news_id, is_read, is_saved, share_count, last_shared_at, updated_at')
    .single();

  if (upsertResult.error || !upsertResult.data) {
    return Response.json(
      { error: 'Haber etkileşimi kaydedilemedi. News interaction migrationı uygulanmalı.' },
      { status: 500 },
    );
  }

  const row = upsertResult.data;
  return Response.json({
    state: {
      newsId: row.news_id,
      isRead: row.is_read ?? false,
      isSaved: row.is_saved ?? false,
      shareCount: Number.isFinite(row.share_count) ? row.share_count : 0,
      lastSharedAt: row.last_shared_at ?? null,
      updatedAt: row.updated_at ?? null,
    },
  });
}
