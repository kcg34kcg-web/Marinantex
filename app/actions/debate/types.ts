export type VoteResponse = {
  success?: boolean;
  error?: string;
  requiresPersuasion?: boolean;
  candidates?: any[];
  newStats?: { a: number, b: number };
  userVote?: 'A' | 'B';
};

export type Debate = {
  id: string;
  title: string;
  topic?: string;
  description: string;
  option_a: string;
  option_b: string;
  ai_summary?: string | null;
  created_at: string;
  created_by: any;
  stats: { a: number; b: number; total: number };
  userVote: 'A' | 'B' | null;
  changeCount: number;
  is_active: boolean;
  is_daily?: boolean;
};

// Yorum tipi eklendi
export type Comment = {
  id: string;
  debate_id: string;
  user_id: string;
  content: string;
  side: 'A' | 'B';
  persuasion_count: number;
  created_at: string;
  score?: number;
  userVoteStatus?: 1 | -1 | 0;
  profiles: {
    id: string;
    full_name: string;
    avatar_url?: string | null;
    job_title?: string | null;
  };
};
