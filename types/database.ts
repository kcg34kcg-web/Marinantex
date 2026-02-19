export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          username: string | null;
          role: Database['public']['Enums']['user_role'];
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          username?: string | null;
          role: Database['public']['Enums']['user_role'];
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string;
          username?: string | null;
          role?: Database['public']['Enums']['user_role'];
          avatar_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      cases: {
        Row: {
          id: string;
          title: string;
          case_code: string | null;
          tags: string[];
          client_display_name: string | null;
          status: Database['public']['Enums']['case_status'];
          lawyer_id: string;
          client_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          case_code?: string | null;
          tags?: string[];
          client_display_name?: string | null;
          status?: Database['public']['Enums']['case_status'];
          lawyer_id: string;
          client_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          case_code?: string | null;
          tags?: string[];
          client_display_name?: string | null;
          status?: Database['public']['Enums']['case_status'];
          lawyer_id?: string;
          client_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cases_lawyer_id_fkey';
            columns: ['lawyer_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cases_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      documents: {
        Row: {
          id: string;
          case_id: string;
          content: string;
          embedding: number[] | null;
          file_path: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          case_id: string;
          content: string;
          embedding?: number[] | null;
          file_path: string;
          created_at?: string;
        };
        Update: {
          case_id?: string;
          content?: string;
          embedding?: number[] | null;
          file_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'documents_case_id_fkey';
            columns: ['case_id'];
            isOneToOne: false;
            referencedRelation: 'cases';
            referencedColumns: ['id'];
          },
        ];
      };
      case_updates: {
        Row: {
          id: string;
          case_id: string;
          message: string;
          date: string;
          is_public_to_client: boolean;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          case_id: string;
          message: string;
          date?: string;
          is_public_to_client?: boolean;
          created_by: string;
          created_at?: string;
        };
        Update: {
          case_id?: string;
          message?: string;
          date?: string;
          is_public_to_client?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'case_updates_case_id_fkey';
            columns: ['case_id'];
            isOneToOne: false;
            referencedRelation: 'cases';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'case_updates_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_chats: {
        Row: {
          id: string;
          user_id: string;
          messages: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          messages?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          messages?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_chats_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      portal_announcements: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          body: string;
          created_at?: string;
        };
        Update: {
          title?: string;
          body?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'portal_announcements_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      office_threads: {
        Row: {
          id: string;
          title: string | null;
          thread_type: string;
          target_role: Database['public']['Enums']['user_role'] | null;
          created_by: string;
          is_archived: boolean;
          last_message_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          title?: string | null;
          thread_type: string;
          target_role?: Database['public']['Enums']['user_role'] | null;
          created_by: string;
          is_archived?: boolean;
          last_message_at?: string;
          created_at?: string;
        };
        Update: {
          title?: string | null;
          thread_type?: string;
          target_role?: Database['public']['Enums']['user_role'] | null;
          is_archived?: boolean;
          last_message_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'office_threads_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      office_thread_members: {
        Row: {
          thread_id: string;
          user_id: string;
          joined_at: string;
          last_read_at: string | null;
          is_muted: boolean;
        };
        Insert: {
          thread_id: string;
          user_id: string;
          joined_at?: string;
          last_read_at?: string | null;
          is_muted?: boolean;
        };
        Update: {
          last_read_at?: string | null;
          is_muted?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'office_thread_members_thread_id_fkey';
            columns: ['thread_id'];
            isOneToOne: false;
            referencedRelation: 'office_threads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'office_thread_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      office_messages: {
        Row: {
          id: string;
          thread_id: string;
          sender_id: string;
          body: string;
          metadata: Json;
          is_deleted: boolean;
          edited_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          thread_id: string;
          sender_id: string;
          body: string;
          metadata?: Json;
          is_deleted?: boolean;
          edited_at?: string | null;
          created_at?: string;
        };
        Update: {
          body?: string;
          metadata?: Json;
          is_deleted?: boolean;
          edited_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'office_messages_thread_id_fkey';
            columns: ['thread_id'];
            isOneToOne: false;
            referencedRelation: 'office_threads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'office_messages_sender_id_fkey';
            columns: ['sender_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      office_broadcasts: {
        Row: {
          id: string;
          sender_id: string;
          title: string;
          body: string;
          target_scope: string;
          created_at: string;
          expires_at: string | null;
        };
        Insert: {
          id?: string;
          sender_id: string;
          title: string;
          body: string;
          target_scope?: string;
          created_at?: string;
          expires_at?: string | null;
        };
        Update: {
          title?: string;
          body?: string;
          target_scope?: string;
          expires_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'office_broadcasts_sender_id_fkey';
            columns: ['sender_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      office_tasks: {
        Row: {
          id: string;
          case_id: string | null;
          source_message_id: string | null;
          thread_id: string | null;
          title: string;
          description: string | null;
          status: string;
          priority: string;
          assigned_to: string | null;
          created_by: string;
          due_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          case_id?: string | null;
          source_message_id?: string | null;
          thread_id?: string | null;
          title: string;
          description?: string | null;
          status?: string;
          priority?: string;
          assigned_to?: string | null;
          created_by: string;
          due_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          case_id?: string | null;
          source_message_id?: string | null;
          thread_id?: string | null;
          title?: string;
          description?: string | null;
          status?: string;
          priority?: string;
          assigned_to?: string | null;
          due_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'office_tasks_case_id_fkey';
            columns: ['case_id'];
            isOneToOne: false;
            referencedRelation: 'cases';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'office_tasks_source_message_id_fkey';
            columns: ['source_message_id'];
            isOneToOne: false;
            referencedRelation: 'office_messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'office_tasks_thread_id_fkey';
            columns: ['thread_id'];
            isOneToOne: false;
            referencedRelation: 'office_threads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'office_tasks_assigned_to_fkey';
            columns: ['assigned_to'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'office_tasks_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      user_role: 'lawyer' | 'assistant' | 'client';
      case_status: 'open' | 'in_progress' | 'closed' | 'archived';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
