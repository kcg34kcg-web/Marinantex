'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/utils/supabase/server';
import type { VoteResponse } from './types';

async function readDebateStats(supabase: Awaited<ReturnType<typeof createClient>>, debateId: string) {
  const { data, error } = await supabase
    .from('social_debates')
    .select('id, vote_count_a, vote_count_b')
    .eq('id', debateId)
    .maybeSingle();

  if (error || !data) {
    throw new Error('Münazara bulunamadı.');
  }

  return {
    a: Number(data.vote_count_a ?? 0),
    b: Number(data.vote_count_b ?? 0),
  };
}

async function writeDebateStats(
  supabase: Awaited<ReturnType<typeof createClient>>,
  debateId: string,
  stats: { a: number; b: number },
) {
  const { error } = await supabase
    .from('social_debates')
    .update({
      vote_count_a: Math.max(0, stats.a),
      vote_count_b: Math.max(0, stats.b),
      updated_at: new Date().toISOString(),
    })
    .eq('id', debateId);

  if (error) {
    throw new Error(error.message);
  }
}

async function getPersuasionCandidates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  debateId: string,
  targetSide: 'A' | 'B',
) {
  const { data } = await supabase
    .from('social_debate_comments')
    .select(
      `
      id,
      content,
      persuasion_count,
      profiles:user_id (
        id,
        full_name,
        avatar_url,
        job_title
      )
    `,
    )
    .eq('debate_id', debateId)
    .eq('side', targetSide)
    .order('persuasion_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(8);

  return data ?? [];
}

export async function voteDailyDebate(debateId: string, choice: 'A' | 'B'): Promise<VoteResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Oy vermek için giriş yapmalısınız.' };

  const rpcAttempt = await supabase.rpc('handle_vote_transaction', {
    p_debate_id: debateId,
    p_user_id: user.id,
    p_new_choice: choice,
  });

  if (!rpcAttempt.error && rpcAttempt.data) {
    const result = Array.isArray(rpcAttempt.data) ? rpcAttempt.data[0] : rpcAttempt.data;
    const newStats = {
      a: Number(result?.new_stats_a ?? 0),
      b: Number(result?.new_stats_b ?? 0),
    };
    revalidatePath('/social');
    return { success: true, newStats, userVote: choice };
  }

  const { data: existingVote, error: voteReadError } = await supabase
    .from('social_debate_votes')
    .select('choice, change_count')
    .eq('debate_id', debateId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (voteReadError) return { error: voteReadError.message };

  try {
    const currentStats = await readDebateStats(supabase, debateId);

    if (existingVote?.choice === choice) {
      return { success: true, newStats: currentStats, userVote: choice };
    }

    if (existingVote?.choice && Number(existingVote.change_count ?? 0) >= 3) {
      const candidates = await getPersuasionCandidates(supabase, debateId, choice === 'A' ? 'B' : 'A');
      return {
        error: 'Fikir değiştirme limitiniz doldu.',
        requiresPersuasion: true,
        candidates,
      };
    }

    const nextStats = { ...currentStats };
    if (existingVote?.choice) {
      if (existingVote.choice === 'A') nextStats.a -= 1;
      if (existingVote.choice === 'B') nextStats.b -= 1;
    }
    if (choice === 'A') nextStats.a += 1;
    if (choice === 'B') nextStats.b += 1;

    if (existingVote?.choice) {
      const { error: updateVoteError } = await supabase
        .from('social_debate_votes')
        .update({
          choice,
          change_count: Number(existingVote.change_count ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('debate_id', debateId)
        .eq('user_id', user.id);

      if (updateVoteError) return { error: updateVoteError.message };
    } else {
      const { error: insertVoteError } = await supabase.from('social_debate_votes').insert({
        debate_id: debateId,
        user_id: user.id,
        choice,
        change_count: 0,
      });

      if (insertVoteError) return { error: insertVoteError.message };
    }

    await writeDebateStats(supabase, debateId, nextStats);
    revalidatePath('/social');
    return { success: true, newStats: nextStats, userVote: choice };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Oy işlemi başarısız oldu.' };
  }
}

export async function markAsPersuasive(debateId: string, commentId: string, commentAuthorId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Giriş yapmalısınız.' };
  if (user.id === commentAuthorId) return { error: 'Kendi yorumunuza alkış atamazsınız.' };

  const { data: existing } = await supabase
    .from('social_persuasions')
    .select('id')
    .eq('comment_id', commentId)
    .eq('persuaded_user_id', user.id)
    .maybeSingle();

  if (existing) return { error: 'Bu yorumu zaten alkışladınız.' };

  const { error: insertError } = await supabase.from('social_persuasions').insert({
    debate_id: debateId,
    comment_id: commentId,
    author_id: commentAuthorId,
    persuaded_user_id: user.id,
  });

  if (insertError) {
    if (insertError.code === '23505') return { error: 'Bu yorumu zaten alkışladınız.' };
    return { error: insertError.message };
  }

  const increment = await supabase.rpc('increment_persuasion', { row_id: commentId });
  if (increment.error) {
    const { data: comment } = await supabase
      .from('social_debate_comments')
      .select('persuasion_count')
      .eq('id', commentId)
      .maybeSingle();
    const next = Number(comment?.persuasion_count ?? 0) + 1;
    await supabase.from('social_debate_comments').update({ persuasion_count: next }).eq('id', commentId);
  }

  revalidatePath('/social');
  return { success: true };
}

export async function postDebateComment(debateId: string, content: string, side: 'A' | 'B') {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Giriş yapmalısınız.' };
  if (!content.trim()) return { error: 'Yorum boş olamaz.' };
  if (content.trim().length > 2000) return { error: 'Yorum çok uzun.' };

  const { data: vote } = await supabase
    .from('social_debate_votes')
    .select('choice')
    .eq('debate_id', debateId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!vote) return { error: 'Önce tarafını seçmelisin.' };
  if (vote.choice !== side) return { error: 'Sadece seçtiğin taraf için yazabilirsin.' };

  const { data: existing } = await supabase
    .from('social_debate_comments')
    .select('id')
    .eq('debate_id', debateId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) return { error: 'Bu tartışmada zaten bir görüş bildirdin.' };

  const { data: savedComment, error } = await supabase
    .from('social_debate_comments')
    .insert({
      debate_id: debateId,
      user_id: user.id,
      content: content.trim(),
      side,
      persuasion_count: 0,
    })
    .select(
      `
      id,
      debate_id,
      user_id,
      content,
      side,
      persuasion_count,
      created_at,
      profiles:user_id (
        id,
        full_name,
        avatar_url,
        job_title
      )
    `,
    )
    .single();

  if (error) return { error: error.message };

  revalidatePath('/social');
  return { success: true, savedData: savedComment };
}

export async function createDebate(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Giriş yapmalısınız.' };

  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const category = String(formData.get('category') ?? 'general').trim() || 'general';
  const optionA = String(formData.get('optionA') ?? 'Katılıyorum').trim() || 'Katılıyorum';
  const optionB = String(formData.get('optionB') ?? 'Katılmıyorum').trim() || 'Katılmıyorum';

  if (title.length < 5) return { error: 'Başlık çok kısa.' };
  if (description.length < 10) return { error: 'Açıklama çok kısa.' };

  const { data, error } = await supabase
    .from('social_debates')
    .insert({
      title,
      description,
      category,
      created_by: user.id,
      is_active: true,
      vote_count_a: 0,
      vote_count_b: 0,
      option_a: optionA,
      option_b: optionB,
    })
    .select('id')
    .single();

  if (error) return { error: error.message };

  revalidatePath('/social');
  return { success: true, debateId: data.id };
}

export async function confirmVoteChange(
  debateId: string,
  newChoice: 'A' | 'B',
  convincedByCommentId: string,
): Promise<VoteResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Yetkisiz işlem.' };
  if (!convincedByCommentId) return { error: 'İkna eden yorumu seçmelisiniz.' };

  const { data: existingVote, error: voteError } = await supabase
    .from('social_debate_votes')
    .select('choice, change_count')
    .eq('debate_id', debateId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (voteError || !existingVote) return { error: 'Önce ilk oyunuzu kullanmalısınız.' };
  if (existingVote.choice === newChoice) return { error: 'Zaten bu taraftasınız.' };

  try {
    const stats = await readDebateStats(supabase, debateId);
    const nextStats = { ...stats };
    if (existingVote.choice === 'A') nextStats.a -= 1;
    if (existingVote.choice === 'B') nextStats.b -= 1;
    if (newChoice === 'A') nextStats.a += 1;
    if (newChoice === 'B') nextStats.b += 1;

    await supabase.rpc('increment_persuasion', { row_id: convincedByCommentId });

    const { error: updateVoteError } = await supabase
      .from('social_debate_votes')
      .update({
        choice: newChoice,
        change_count: Number(existingVote.change_count ?? 0) + 1,
        convinced_by_comment_id: convincedByCommentId,
        updated_at: new Date().toISOString(),
      })
      .eq('debate_id', debateId)
      .eq('user_id', user.id);

    if (updateVoteError) return { error: updateVoteError.message };

    await writeDebateStats(supabase, debateId, nextStats);
    revalidatePath('/social');
    return { success: true, newStats: nextStats, userVote: newChoice };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Değişiklik kaydedilemedi.' };
  }
}

export async function voteComment(commentId: string, voteType: 1 | -1) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Giriş yapmalısınız.' };

  const { data: comment, error: commentError } = await supabase
    .from('social_debate_comments')
    .select('id, persuasion_count')
    .eq('id', commentId)
    .maybeSingle();

  if (commentError || !comment) return { error: 'Yorum bulunamadı.' };

  const { data: existingVote } = await supabase
    .from('social_comment_votes')
    .select('vote_type')
    .eq('comment_id', commentId)
    .eq('user_id', user.id)
    .maybeSingle();

  let delta = Number(voteType);

  if (existingVote?.vote_type === voteType) {
    const { error } = await supabase
      .from('social_comment_votes')
      .delete()
      .eq('comment_id', commentId)
      .eq('user_id', user.id);
    if (error) return { error: error.message };
    delta = -Number(voteType);
  } else if (existingVote?.vote_type) {
    const { error } = await supabase
      .from('social_comment_votes')
      .update({ vote_type: voteType, updated_at: new Date().toISOString() })
      .eq('comment_id', commentId)
      .eq('user_id', user.id);
    if (error) return { error: error.message };
    delta = voteType - Number(existingVote.vote_type);
  } else {
    const { error } = await supabase.from('social_comment_votes').insert({
      comment_id: commentId,
      user_id: user.id,
      vote_type: voteType,
    });
    if (error) return { error: error.message };
  }

  const nextScore = Math.max(0, Number(comment.persuasion_count ?? 0) + delta);
  const { error: updateScoreError } = await supabase
    .from('social_debate_comments')
    .update({ persuasion_count: nextScore })
    .eq('id', commentId);

  if (updateScoreError) return { error: updateScoreError.message };

  revalidatePath('/social');
  return { success: true, score: nextScore };
}
