import { createClient } from '@/utils/supabase/server';
import type { UserRole } from '@/types';

export type InternalOfficeRole = Extract<UserRole, 'lawyer' | 'assistant'>;

export async function requireInternalOfficeUser() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false as const, status: 401, message: 'Oturum doğrulanamadı.' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return { ok: false as const, status: 403, message: 'Profil doğrulanamadı.' };
  }

  if (profile.role !== 'lawyer' && profile.role !== 'assistant') {
    return { ok: false as const, status: 403, message: 'Bu alan sadece ofis ekibine açıktır.' };
  }

  return {
    ok: true as const,
    userId: user.id,
    role: profile.role as InternalOfficeRole,
    supabase,
  };
}
