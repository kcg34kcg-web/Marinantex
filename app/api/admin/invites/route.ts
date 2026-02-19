import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';
import { createAdminClient } from '@/utils/supabase/admin';

const createInviteSchema = z.object({
  email: z.string().email(),
  targetRole: z.enum(['lawyer', 'assistant', 'client']),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

async function requireInternalUser() {
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
    return { ok: false as const, status: 403, message: 'Bu işlem için dahili kullanıcı yetkisi gerekir.' };
  }

  return { ok: true as const, userId: user.id };
}

export async function GET() {
  const access = await requireInternalUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('user_invites')
    .select('id, email, target_role, expires_at, accepted_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return Response.json({ error: 'Davet listesi alınamadı.' }, { status: 500 });
  }

  return Response.json({ invites: data ?? [] });
}

export async function POST(request: Request) {
  const access = await requireInternalUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = createInviteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz davet verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const token = `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
  const expiresAt = new Date(Date.now() + payload.expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('user_invites')
    .insert({
      email: payload.email.toLowerCase(),
      target_role: payload.targetRole,
      token,
      invited_by: access.userId,
      expires_at: expiresAt,
    })
    .select('id, email, target_role, expires_at, accepted_at, created_at')
    .single();

  if (error || !data) {
    return Response.json({ error: 'Davet oluşturulamadı.' }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const inviteUrl = `${origin}/signup?invite=${token}`;

  return Response.json({ invite: data, inviteUrl });
}
