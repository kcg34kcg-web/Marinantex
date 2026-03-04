'use server';

import { unstable_noStore as noStore } from 'next/cache';
import { createClient } from '@/utils/supabase/server';
import type { Comment, Debate } from './types';

function mapDebateRecord(raw: any, userVote: 'A' | 'B' | null, changeCount: number): Debate {
  const votesA = Number(raw?.vote_count_a ?? 0);
  const votesB = Number(raw?.vote_count_b ?? 0);
  const title = raw?.title ?? raw?.topic ?? '';

  return {
    id: raw.id,
    title,
    topic: title,
    description: raw?.description ?? '',
    option_a: raw?.option_a ?? 'Katılıyorum',
    option_b: raw?.option_b ?? 'Katılmıyorum',
    ai_summary: raw?.ai_summary ?? null,
    created_at: raw?.created_at ?? new Date().toISOString(),
    created_by: raw?.profiles ?? null,
    stats: {
      a: votesA,
      b: votesB,
      total: votesA + votesB,
    },
    userVote,
    changeCount,
    is_active: Boolean(raw?.is_active),
    is_daily: Boolean(raw?.is_daily_featured),
  };
}

export async function getDailyDebate(): Promise<Debate | null> {
  noStore();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const today = new Date().toISOString().slice(0, 10);

  const dailyQuery = await supabase
    .from('social_debates')
    .select(
      `
      id,
      title,
      description,
      option_a,
      option_b,
      ai_summary,
      is_active,
      is_daily_featured,
      featured_date,
      vote_count_a,
      vote_count_b,
      created_at,
      created_by,
      profiles:created_by (
        id,
        full_name,
        username,
        avatar_url
      )
    `,
    )
    .eq('is_daily_featured', true)
    .eq('featured_date', today)
    .maybeSingle();

  let rawDebate = dailyQuery.data;

  if (!rawDebate) {
    const { data: candidates } = await supabase
      .from('social_debates')
      .select(
        `
        id,
        title,
        description,
        option_a,
        option_b,
        ai_summary,
        is_active,
        is_daily_featured,
        featured_date,
        vote_count_a,
        vote_count_b,
        created_at,
        created_by,
        profiles:created_by (
          id,
          full_name,
          username,
          avatar_url
        )
      `,
      )
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(20);

    rawDebate =
      candidates?.sort(
        (a: any, b: any) =>
          Number(b?.vote_count_a ?? 0) + Number(b?.vote_count_b ?? 0) - (Number(a?.vote_count_a ?? 0) + Number(a?.vote_count_b ?? 0)),
      )[0] ?? null;
  }

  if (!rawDebate) return null;

  let userVote: 'A' | 'B' | null = null;
  let changeCount = 0;

  if (user?.id) {
    const { data: voteData } = await supabase
      .from('social_debate_votes')
      .select('choice, change_count')
      .eq('debate_id', rawDebate.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (voteData) {
      userVote = voteData.choice as 'A' | 'B';
      changeCount = Number(voteData.change_count ?? 0);
    }
  }

  return mapDebateRecord(rawDebate, userVote, changeCount);
}

export async function getDebateFeed(page = 0, limit = 10, search?: string): Promise<Debate[]> {
  noStore();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const safePage = Math.max(0, page);
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const from = safePage * safeLimit;
  const to = from + safeLimit - 1;

  const rpcResult = await supabase.rpc('get_debate_feed', {
    p_user_id: user?.id ?? null,
    p_limit: safeLimit,
    p_offset: from,
    p_search: search?.trim() ? search.trim() : null,
  });

  if (!rpcResult.error && Array.isArray(rpcResult.data) && rpcResult.data.length > 0) {
    return rpcResult.data.map((row: any) => ({
      id: row.id,
      title: row.title,
      topic: row.title,
      description: row.description ?? '',
      option_a: row.option_a ?? 'Katılıyorum',
      option_b: row.option_b ?? 'Katılmıyorum',
      ai_summary: row.ai_summary ?? null,
      created_at: row.created_at,
      created_by: row.created_by_data ?? null,
      stats: {
        a: Number(row.stats_a ?? 0),
        b: Number(row.stats_b ?? 0),
        total: Number(row.stats_a ?? 0) + Number(row.stats_b ?? 0),
      },
      userVote: (row.user_vote as 'A' | 'B' | null) ?? null,
      changeCount: Number(row.user_change_count ?? 0),
      is_active: Boolean(row.is_active),
    }));
  }

  let query = supabase
    .from('social_debates')
    .select(
      `
      id,
      title,
      description,
      option_a,
      option_b,
      ai_summary,
      is_active,
      vote_count_a,
      vote_count_b,
      created_at,
      created_by,
      profiles:created_by (
        id,
        full_name,
        username,
        avatar_url
      )
    `,
    )
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (search?.trim()) {
    const q = search.trim();
    query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%,category.ilike.%${q}%`);
  }

  const { data: debates, error } = await query;
  if (error || !debates?.length) return [];

  const voteMap = new Map<string, { choice: 'A' | 'B'; change_count: number }>();
  if (user?.id) {
    const ids = debates.map((d: any) => d.id);
    const { data: votes } = await supabase
      .from('social_debate_votes')
      .select('debate_id, choice, change_count')
      .eq('user_id', user.id)
      .in('debate_id', ids);

    for (const vote of votes ?? []) {
      voteMap.set(vote.debate_id, vote as { choice: 'A' | 'B'; change_count: number });
    }
  }

  return debates.map((row: any) => {
    const vote = voteMap.get(row.id);
    return mapDebateRecord(row, vote?.choice ?? null, Number(vote?.change_count ?? 0));
  });
}

export async function getDebateComments(debateId: string): Promise<Comment[]> {
  noStore();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('social_debate_comments')
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
    .eq('debate_id', debateId)
    .order('persuasion_count', { ascending: false })
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  const comments = data as any[];
  const voteStatusByComment = new Map<string, 1 | -1>();

  if (user?.id && comments.length > 0) {
    const { data: votes } = await supabase
      .from('social_comment_votes')
      .select('comment_id, vote_type')
      .eq('user_id', user.id)
      .in(
        'comment_id',
        comments.map((c) => c.id),
      );

    for (const vote of votes ?? []) {
      voteStatusByComment.set(vote.comment_id, vote.vote_type as 1 | -1);
    }
  }

  return comments.map((comment) => ({
    ...comment,
    score: Number(comment.persuasion_count ?? 0),
    userVoteStatus: voteStatusByComment.get(comment.id) ?? 0,
  })) as Comment[];
}

export async function generateSmartTitles(topic: string): Promise<string[]> {
  const seed = topic.trim();
  if (seed.length < 3) return [];

  return [
    `${seed} gerçekten adaletli bir düzen sağlar mı?`,
    `${seed} toplum için fırsat mı risk mi?`,
    `${seed} sınırlandırılmalı mı yoksa teşvik edilmeli mi?`,
    `${seed} konusunda en doğru yaklaşım nedir?`,
  ];
}

