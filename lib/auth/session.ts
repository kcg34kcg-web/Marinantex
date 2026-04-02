import { createClient } from '@/utils/supabase/server';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  bureauId: string | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  const profileResult = await supabase
    .from('profiles')
    .select('full_name, bureau_id')
    .eq('id', user.id)
    .maybeSingle();

  const profile = (profileResult.data ?? null) as { full_name?: string | null; bureau_id?: string | null } | null;

  return {
    id: user.id,
    email: user.email ?? '',
    name: profile?.full_name ?? (typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null),
    bureauId: profile?.bureau_id ?? null,
  };
}
