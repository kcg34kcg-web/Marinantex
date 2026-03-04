'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/utils/supabase/server';

export type InteractionAction = 'not_interested' | 'block' | 'mute';

export async function handleInteraction(postId: string, authorId: string, action: InteractionAction) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Yetkisiz işlem');
  }

  if (action === 'not_interested') {
    const { error } = await supabase.from('social_post_interactions').upsert(
      {
        user_id: user.id,
        post_id: postId,
        author_id: authorId,
        action,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,post_id' },
    );

    if (error) throw error;
  } else {
    const { error } = await supabase.from('social_user_controls').upsert(
      {
        user_id: user.id,
        target_user_id: authorId,
        action,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,target_user_id' },
    );

    if (error) throw error;
  }

  revalidatePath('/social');
  return { success: true };
}

