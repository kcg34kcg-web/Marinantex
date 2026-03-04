'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/utils/supabase/server';

type PollVoteResult = {
  success?: boolean;
  status?: 'voted' | 'updated' | 'retracted';
  error?: string;
};

async function readPollOptionCount(supabase: Awaited<ReturnType<typeof createClient>>, optionId: string) {
  const { data, error } = await supabase.from('poll_options').select('vote_count').eq('id', optionId).maybeSingle();
  if (error) throw error;
  return Math.max(0, Number(data?.vote_count ?? 0));
}

async function applyOptionDelta(
  supabase: Awaited<ReturnType<typeof createClient>>,
  optionId: string,
  delta: number,
) {
  const current = await readPollOptionCount(supabase, optionId);
  const next = Math.max(0, current + delta);
  const { error } = await supabase.from('poll_options').update({ vote_count: next }).eq('id', optionId);
  if (error) throw error;
}

export async function castPollVote(pollId: string, optionId: string): Promise<PollVoteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Oy kullanmak için giriş yapmalısın.' };

  const { data: poll, error: pollError } = await supabase
    .from('polls')
    .select('id, is_closed, expires_at')
    .eq('id', pollId)
    .maybeSingle();

  if (pollError || !poll) return { error: 'Anket bulunamadı.' };
  if (poll.is_closed) return { error: 'Anket kapatılmış.' };
  if (poll.expires_at && new Date(poll.expires_at).getTime() <= Date.now()) return { error: 'Anket süresi dolmuş.' };

  const { data: option, error: optionError } = await supabase
    .from('poll_options')
    .select('id')
    .eq('id', optionId)
    .eq('poll_id', pollId)
    .maybeSingle();

  if (optionError || !option) return { error: 'Geçersiz seçenek.' };

  const { data: existingVote, error: voteReadError } = await supabase
    .from('poll_votes')
    .select('option_id')
    .eq('poll_id', pollId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (voteReadError) return { error: voteReadError.message };

  try {
    if (existingVote?.option_id === optionId) {
      const { error: deleteError } = await supabase
        .from('poll_votes')
        .delete()
        .eq('poll_id', pollId)
        .eq('user_id', user.id);

      if (deleteError) return { error: deleteError.message };
      await applyOptionDelta(supabase, optionId, -1);
      revalidatePath('/social');
      return { success: true, status: 'retracted' };
    }

    if (existingVote?.option_id) {
      const { error: updateError } = await supabase
        .from('poll_votes')
        .update({ option_id: optionId, updated_at: new Date().toISOString() })
        .eq('poll_id', pollId)
        .eq('user_id', user.id);

      if (updateError) return { error: updateError.message };
      await applyOptionDelta(supabase, existingVote.option_id, -1);
      await applyOptionDelta(supabase, optionId, 1);
      revalidatePath('/social');
      return { success: true, status: 'updated' };
    }

    const { error: insertError } = await supabase.from('poll_votes').insert({
      poll_id: pollId,
      option_id: optionId,
      user_id: user.id,
    });

    if (insertError) return { error: insertError.message };
    await applyOptionDelta(supabase, optionId, 1);
    revalidatePath('/social');
    return { success: true, status: 'voted' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Anket oyu kaydedilemedi.' };
  }
}

export async function getPollVoters(pollId: string, optionId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('poll_votes')
    .select(
      `
      user_id,
      profiles:user_id (
        id,
        full_name,
        username,
        avatar_url
      )
    `,
    )
    .eq('poll_id', pollId)
    .eq('option_id', optionId)
    .order('created_at', { ascending: false });

  if (error) return { success: false, error: error.message, data: [] as any[] };

  const mapped =
    data?.map((row: any) => ({
      user_id: row.user_id,
      full_name: row.profiles?.full_name ?? null,
      username: row.profiles?.username ?? null,
      avatar_url: row.profiles?.avatar_url ?? null,
    })) ?? [];

  return { success: true, data: mapped };
}

