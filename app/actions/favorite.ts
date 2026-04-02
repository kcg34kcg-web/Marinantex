'use server';

import { createClient } from '@/utils/supabase/server';

export async function toggleFavoriteAction(itemId: string, type: 'question' | 'answer' = 'question') {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Oturum bulunamadı.');
  }

  const table = supabase.from('favorites');
  const existing = await table
    .select('id')
    .eq('user_id', user.id)
    .eq('item_id', itemId)
    .eq('item_type', type)
    .maybeSingle();

  if (existing.data?.id) {
    const { error } = await table.delete().eq('id', existing.data.id);
    if (error) {
      throw new Error('Favori kaydı kaldırılamadı.');
    }
    return { favorited: false };
  }

  const { error } = await table.insert({
    user_id: user.id,
    item_id: itemId,
    item_type: type,
  });

  if (error) {
    throw new Error('Favori kaydı eklenemedi.');
  }

  return { favorited: true };
}
