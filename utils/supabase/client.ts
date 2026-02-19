import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';
import { clientEnv } from '@/lib/config/env.client';

const supabaseUrl = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function createClient() {
  if (!supabaseUrl) {
    throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_URL');
  }

  if (!supabaseAnonKey) {
    throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
