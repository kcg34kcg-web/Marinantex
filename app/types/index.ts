export type ReactionType = 'woow' | 'doow' | 'adil';

export interface UserProfile {
  id: string;
  full_name: string | null;
  username?: string | null;
  avatar_url?: string | null;
  reputation?: number;
  is_private?: boolean;
}

export interface ExtendedProfile extends UserProfile {
  biography?: string | null;
  is_social_private: boolean;
  is_academic_private: boolean;
  phone?: string | null;
  address?: string | null;
  university?: string | null;
  credits?: number;
}

export interface PostData {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  author_name: string;
  author_avatar?: string | null;
  author_username?: string | null;
  author_reputation?: number;
  image_url?: string | null;
  is_event?: boolean;
  event_date?: string | null;
  event_location?: { name?: string | null } | string | null;
  woow_count: number;
  doow_count: number;
  adil_count: number;
  comment_count: number;
  my_reaction: ReactionType | null;
}

export interface PollOption {
  id: string;
  poll_id: string;
  option_text: string;
  display_order: number;
  vote_count: number;
}

export interface Poll {
  id: string;
  creator_id: string;
  question: string;
  expires_at: string;
  is_closed: boolean;
  is_anonymous: boolean;
  created_at: string;
  user_vote?: string | null;
  options: PollOption[];
}

export interface Debate {
  id: string;
  title: string;
  topic?: string;
  description: string;
  option_a: string;
  option_b: string;
  ai_summary?: string | null;
  created_at: string;
  created_by?: UserProfile | null;
  stats: {
    a: number;
    b: number;
    total: number;
  };
  userVote: 'A' | 'B' | null;
  changeCount: number;
  is_active: boolean;
  is_daily?: boolean;
}

export interface DebateComment {
  id: string;
  debate_id: string;
  user_id: string;
  side: 'A' | 'B';
  content: string;
  persuasion_count: number;
  created_at: string;
  profiles?: {
    id: string;
    full_name: string;
    avatar_url?: string | null;
    job_title?: string | null;
  } | null;
  score?: number;
  userVoteStatus?: 1 | -1 | 0 | null;
}

export interface FlatComment {
  id: string;
  post_id: string;
  parent_id: string | null;
  user_id: string;
  content: string;
  created_at: string;
  author_name: string;
  author_username?: string | null;
  author_avatar?: string | null;
  woow_count: number;
  doow_count: number;
  adil_count: number;
  reply_count: number;
  my_reaction: ReactionType | null;
  score: number;
}

