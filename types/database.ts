export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type GenericTable<Row extends Record<string, any> = Record<string, any>> = {
  Row: Row;
  Insert: Partial<Row> & Record<string, any>;
  Update: Partial<Row> & Record<string, any>;
  Relationships: Relationship[];
};

type GenericView<Row extends Record<string, any> = Record<string, any>> = {
  Row: Row;
  Relationships: Relationship[];
};

type GenericFunction = {
  Args: Record<string, any>;
  Returns: any;
};

export interface Database {
  public: {
    Tables: {
      profiles: GenericTable<{
        id: string;
        full_name: string;
        username: string | null;
        role: 'lawyer' | 'assistant' | 'client';
        avatar_url: string | null;
        reputation: number;
        credits: number;
        biography: string | null;
        phone: string | null;
        address: string | null;
        university: string | null;
        is_private: boolean;
        is_social_private: boolean;
        is_academic_private: boolean;
        created_at: string;
        updated_at: string;
      }>;

      posts: GenericTable<{
        id: string;
        user_id: string;
        content: string;
        image_url: string | null;
        category: string | null;
        is_event: boolean;
        event_date: string | null;
        event_location: Json | null;
        event_status: string | null;
        created_at: string;
        updated_at: string;
      }>;

      post_reactions: GenericTable<{
        id: string;
        post_id: string;
        user_id: string;
        reaction_type: 'woow' | 'doow' | 'adil';
        created_at: string;
      }>;

      comments: GenericTable<{
        id: string;
        post_id: string;
        user_id: string;
        parent_id: string | null;
        content: string;
        created_at: string;
        updated_at: string;
      }>;

      comment_reactions: GenericTable<{
        id: string;
        comment_id: string;
        user_id: string;
        reaction_type: 'woow' | 'doow' | 'adil';
        created_at: string;
      }>;

      polls: GenericTable<{
        id: string;
        creator_id: string;
        question: string;
        is_anonymous: boolean;
        is_closed: boolean;
        expires_at: string;
        created_at: string;
        updated_at: string;
      }>;

      poll_options: GenericTable<{
        id: string;
        poll_id: string;
        option_text: string;
        display_order: number;
        vote_count: number;
        created_at: string;
      }>;

      poll_votes: GenericTable<{
        id: string;
        poll_id: string;
        option_id: string;
        user_id: string;
        created_at: string;
        updated_at: string;
      }>;

      follows: GenericTable<{
        id: string;
        follower_id: string;
        following_id: string;
        status: 'pending' | 'accepted';
        created_at: string;
      }>;

      notifications: GenericTable<{
        id: string;
        recipient_id: string;
        actor_id: string | null;
        type: string;
        title: string | null;
        body: string | null;
        resource_type: string | null;
        resource_id: string | null;
        is_read: boolean;
        created_at: string;
      }>;

      conversations: GenericTable<{
        id: string;
        created_by: string;
        updated_at: string;
        last_message_preview: string | null;
        created_at: string;
      }>;

      conversation_participants: GenericTable<{
        id: string;
        conversation_id: string;
        user_id: string;
        last_read_at: string | null;
        created_at: string;
      }>;

      messages: GenericTable<{
        id: string;
        conversation_id: string;
        sender_id: string;
        content: string | null;
        media_url: string | null;
        media_type: string | null;
        deleted_at: string | null;
        created_at: string;
      }>;

      social_debates: GenericTable<{
        id: string;
        title: string;
        description: string;
        category: string | null;
        option_a: string;
        option_b: string;
        ai_summary: string | null;
        created_by: string;
        is_active: boolean;
        is_daily_featured: boolean;
        featured_date: string | null;
        vote_count_a: number;
        vote_count_b: number;
        created_at: string;
        updated_at: string;
      }>;

      social_debate_votes: GenericTable<{
        id: string;
        debate_id: string;
        user_id: string;
        choice: 'A' | 'B';
        change_count: number;
        convinced_by_comment_id: string | null;
        created_at: string;
        updated_at: string;
      }>;

      social_debate_comments: GenericTable<{
        id: string;
        debate_id: string;
        user_id: string;
        side: 'A' | 'B';
        content: string;
        persuasion_count: number;
        created_at: string;
        updated_at: string;
      }>;

      social_persuasions: GenericTable<{
        id: string;
        debate_id: string;
        comment_id: string;
        author_id: string;
        persuaded_user_id: string;
        created_at: string;
      }>;

      social_comment_votes: GenericTable<{
        id: string;
        comment_id: string;
        user_id: string;
        vote_type: 1 | -1;
        created_at: string;
        updated_at: string;
      }>;

      social_post_interactions: GenericTable<{
        id: string;
        user_id: string;
        post_id: string;
        author_id: string;
        action: 'not_interested';
        created_at: string;
      }>;

      social_user_controls: GenericTable<{
        id: string;
        user_id: string;
        target_user_id: string;
        action: 'mute' | 'block';
        created_at: string;
      }>;

      [key: string]: GenericTable;
    };

    Views: {
      comments_with_stats: GenericView;
      posts_with_stats: GenericView;
      [key: string]: GenericView;
    };

    Functions: {
      fetch_feed_candidates: GenericFunction;
      handle_reaction: GenericFunction;
      get_or_create_dm: GenericFunction;
      get_debate_feed: GenericFunction;
      handle_vote_transaction: GenericFunction;
      increment_persuasion: GenericFunction;
      increment_counter: GenericFunction;
      save_rag_output_transaction: GenericFunction;
      [key: string]: GenericFunction;
    };

    Enums: {
      user_role: 'lawyer' | 'assistant' | 'client';
      case_status: 'open' | 'in_progress' | 'closed' | 'archived';
      [key: string]: string;
    };

    CompositeTypes: {
      [key: string]: Record<string, any>;
    };
  };
}

