import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';

const usernamePattern = /^[a-z0-9._]+$/;

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  username: z
    .string()
    .trim()
    .max(40)
    .optional()
    .refine((value) => !value || value.length === 0 || value.length >= 3, {
      message: 'Kullanıcı adı girildiyse en az 3 karakter olmalı.',
    })
    .refine((value) => !value || value.length === 0 || usernamePattern.test(value), {
      message: 'Kullanıcı adı sadece a-z, 0-9, . ve _ içerebilir.',
    }),
});

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
    }

    const profileResult = await supabase
      .from('profiles')
      .select('id, full_name, username, role')
      .eq('id', user.id)
      .single();

    const profileResultFallback =
      profileResult.error?.code === '42703'
        ? await supabase
            .from('profiles')
            .select('id, full_name, role')
            .eq('id', user.id)
            .single()
        : profileResult;

    const profile = profileResultFallback.data;
    if (profileResultFallback.error || !profile) {
      return Response.json({ error: 'Profil bilgisi alınamadı.' }, { status: 500 });
    }

    const profileRecord = profile as Record<string, unknown>;

    return Response.json({
      profile: {
        id: profile.id,
        fullName: profile.full_name,
        username: typeof profileRecord.username === 'string' ? profileRecord.username : null,
        role: profile.role,
        email: user.email ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Profil bilgisi alınamadı.';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
    }

    const payload = updateProfileSchema.safeParse(await request.json());
    if (!payload.success) {
      return Response.json({ error: 'Geçersiz profil verisi.' }, { status: 400 });
    }

    const normalizedUsername = payload.data.username?.trim().toLowerCase() || null;

    const updateResult = await supabase
      .from('profiles')
      .update({
        full_name: payload.data.fullName.trim(),
        username: normalizedUsername,
      })
      .eq('id', user.id)
      .select('id, full_name, username, role')
      .single();

    const updateResultFallback =
      updateResult.error?.code === '42703'
        ? await supabase
            .from('profiles')
            .update({
              full_name: payload.data.fullName.trim(),
            })
            .eq('id', user.id)
            .select('id, full_name, role')
            .single()
        : updateResult;

    if (updateResultFallback.error || !updateResultFallback.data) {
      if (updateResultFallback.error?.code === '23505') {
        return Response.json({ error: 'Bu kullanıcı adı kullanımda.' }, { status: 409 });
      }

      return Response.json({ error: 'Profil güncellenemedi.' }, { status: 500 });
    }

    const profileRecord = updateResultFallback.data as Record<string, unknown>;

    return Response.json({
      profile: {
        id: updateResultFallback.data.id,
        fullName: updateResultFallback.data.full_name,
        username: typeof profileRecord.username === 'string' ? profileRecord.username : null,
        role: updateResultFallback.data.role,
        email: user.email ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Profil güncellenemedi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
