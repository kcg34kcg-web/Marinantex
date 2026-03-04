import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const createPostSchema = z.object({
  postType: z.enum(['announcement', 'short_note', 'task_reminder', 'file_link']),
  title: z.string().trim().max(180).optional(),
  body: z.string().min(1).max(4000),
  caseId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const admin = createAdminClient();

  const postsResult = await admin
    .from('feed_posts')
    .select('id, author_id, post_type, title, body, case_id, metadata, created_at, updated_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(150);

  if (postsResult.error) {
    return Response.json({ error: 'Ana akis gönderileri alinamadi.' }, { status: 500 });
  }

  const posts = postsResult.data ?? [];
  const authorIds = [...new Set(posts.map((item) => item.author_id))];
  const postIds = posts.map((item) => item.id);

  const [authorsResult, commentRowsResult] = await Promise.all([
    authorIds.length
      ? admin
          .from('profiles')
          .select('id, full_name, role')
          .in('id', authorIds)
      : Promise.resolve({ data: [], error: null }),
    postIds.length
      ? admin
          .from('feed_comments')
          .select('id, post_id, author_id, body, created_at')
          .in('post_id', postIds)
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const authorById = new Map(
    ((authorsResult.data ?? []) as Array<{ id: string; full_name: string; role: string }>).map((item) => [
      item.id,
      {
        id: item.id,
        fullName: item.full_name,
        role: item.role,
      },
    ])
  );

  const commentRows = (commentRowsResult.data ?? []) as Array<{
    id: string;
    post_id: string;
    author_id: string;
    body: string;
    created_at: string;
  }>;

  const commentsByPostId = new Map<string, Array<{
    id: string;
    authorId: string;
    authorName: string;
    body: string;
    createdAt: string;
  }>>();

  commentRows.forEach((row) => {
    const current = commentsByPostId.get(row.post_id) ?? [];
    const author = authorById.get(row.author_id);
    current.push({
      id: row.id,
      authorId: row.author_id,
      authorName: author?.fullName ?? 'Kullanici',
      body: row.body,
      createdAt: row.created_at,
    });
    commentsByPostId.set(row.post_id, current);
  });

  return Response.json({
    items: posts.map((item) => {
      const author = authorById.get(item.author_id);
      return {
        id: item.id,
        postType: item.post_type,
        title: item.title,
        body: item.body,
        caseId: item.case_id,
        metadata: item.metadata ?? {},
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        author: {
          id: item.author_id,
          fullName: author?.fullName ?? 'Kullanici',
          role: author?.role ?? 'assistant',
        },
        comments: commentsByPostId.get(item.id) ?? [],
      };
    }),
  });
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = createPostSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz ana akis gönderisi.' }, { status: 400 });
  }

  const payload = parsed.data;

  if (payload.postType === 'announcement' && access.role !== 'lawyer') {
    return Response.json({ error: 'Duyuru gönderisi için avukat yetkisi gerekir.' }, { status: 403 });
  }

  const admin = createAdminClient();

  const insertResult = await admin
    .from('feed_posts')
    .insert({
      author_id: access.userId,
      post_type: payload.postType,
      title: payload.title ?? null,
      body: payload.body,
      case_id: payload.caseId ?? null,
      metadata: payload.metadata ?? {},
    })
    .select('id, author_id, post_type, title, body, case_id, metadata, created_at, updated_at')
    .single();

  if (insertResult.error || !insertResult.data) {
    return Response.json({ error: 'Gönderi paylasilamadi.' }, { status: 500 });
  }

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'office_feed_post_created',
    entityType: 'feed_post',
    entityId: insertResult.data.id,
    metadata: {
      postType: payload.postType,
      caseId: payload.caseId ?? null,
    },
  });

  return Response.json({
    post: {
      id: insertResult.data.id,
      postType: insertResult.data.post_type,
      title: insertResult.data.title,
      body: insertResult.data.body,
      caseId: insertResult.data.case_id,
      metadata: insertResult.data.metadata ?? {},
      createdAt: insertResult.data.created_at,
      updatedAt: insertResult.data.updated_at,
      author: {
        id: access.userId,
      },
    },
  });
}

