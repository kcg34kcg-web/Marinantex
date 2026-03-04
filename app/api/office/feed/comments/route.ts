import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const createCommentSchema = z.object({
  postId: z.string().uuid(),
  body: z.string().min(1).max(1500),
});

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = createCommentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz yorum verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  const postCheck = await admin
    .from('feed_posts')
    .select('id')
    .eq('id', payload.postId)
    .is('deleted_at', null)
    .maybeSingle();

  if (postCheck.error || !postCheck.data) {
    return Response.json({ error: 'Yorum yapilacak gönderi bulunamadi.' }, { status: 404 });
  }

  const insertResult = await admin
    .from('feed_comments')
    .insert({
      post_id: payload.postId,
      author_id: access.userId,
      body: payload.body,
    })
    .select('id, post_id, author_id, body, created_at')
    .single();

  if (insertResult.error || !insertResult.data) {
    return Response.json({ error: 'Yorum kaydedilemedi.' }, { status: 500 });
  }

  await logDashboardAudit(admin, {
    actorUserId: access.userId,
    action: 'office_feed_comment_created',
    entityType: 'feed_comment',
    entityId: insertResult.data.id,
    metadata: {
      postId: payload.postId,
    },
  });

  return Response.json({
    comment: {
      id: insertResult.data.id,
      postId: insertResult.data.post_id,
      authorId: insertResult.data.author_id,
      body: insertResult.data.body,
      createdAt: insertResult.data.created_at,
    },
  });
}

