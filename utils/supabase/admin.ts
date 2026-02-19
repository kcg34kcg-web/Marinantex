import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/config/env.server';

const supabaseUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = serverEnv.SUPABASE_SERVICE_KEY;

export function createAdminClient() {
  if (!supabaseUrl) {
    throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_URL');
  }

  if (!serviceKey) {
    throw new Error('Missing environment variable: SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
