'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { createAdminClient } from '../../utils/supabase/admin';
import type { ActionResult } from '@/types';
import type { UserRole } from '@/types';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  nextPath: z.string().optional(),
  expectedRole: z.enum(['lawyer', 'assistant', 'client']).optional(),
});

const signupSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8),
  inviteToken: z.string().min(16),
  username: z.string().trim().min(3).max(40).regex(/^[a-z0-9._]+$/).optional(),
});

const onboardingSchema = z.object({
  fullName: z.string().min(2).max(120),
  role: z.enum(['lawyer', 'assistant', 'client']),
  nextPath: z.string().optional(),
});

function isSafeRedirect(pathname: string | undefined): pathname is string {
  if (!pathname) {
    return false;
  }

  return pathname.startsWith('/') && !pathname.startsWith('//') && !pathname.startsWith('/api');
}

export async function loginAction(
  _previousState: ActionResult<{ redirectTo: string }> | undefined,
  formData: FormData
): Promise<ActionResult<{ redirectTo: string }>> {
  try {
    const payload = loginSchema.safeParse({
      email: formData.get('email'),
      password: formData.get('password'),
      nextPath: formData.get('nextPath') ?? undefined,
      expectedRole: formData.get('expectedRole') ?? undefined,
    });

    if (!payload.success) {
      return { success: false, error: 'Lütfen geçerli e-posta ve şifre girin.' };
    }

    const supabase = await createClient();

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: payload.data.email,
      password: payload.data.password,
    });

    if (authError || !authData.user) {
      return { success: false, error: 'Giriş başarısız. Bilgilerinizi kontrol edin.' };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .single();

    if (profileError || !profile) {
      const redirectTo = `/onboarding?next=${encodeURIComponent(
        isSafeRedirect(payload.data.nextPath) ? payload.data.nextPath : '/dashboard'
      )}`;
      return { success: true, data: { redirectTo } };
    }

    if (payload.data.expectedRole && profile.role !== payload.data.expectedRole) {
      const roleLabel =
        payload.data.expectedRole === 'lawyer'
          ? 'avukat'
          : payload.data.expectedRole === 'assistant'
            ? 'asistan'
            : 'müvekkil';
      return {
        success: false,
        error: `Bu hesap ${roleLabel} girişi için uygun değil. Lütfen doğru giriş tipini seçin.`,
      };
    }

    const defaultRedirect = profile.role === 'client' ? '/portal' : '/dashboard';
    const redirectTo = isSafeRedirect(payload.data.nextPath) ? payload.data.nextPath : defaultRedirect;

    return { success: true, data: { redirectTo } };
  } catch {
    return { success: false, error: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.' };
  }
}

export async function signupAction(
  _previousState: ActionResult<{ redirectTo: string }> | undefined,
  formData: FormData
): Promise<ActionResult<{ redirectTo: string }>> {
  try {
    const payload = signupSchema.safeParse({
      fullName: formData.get('fullName'),
      email: formData.get('email'),
      password: formData.get('password'),
      inviteToken: formData.get('inviteToken'),
      username: formData.get('username') ?? undefined,
    });

    if (!payload.success) {
      return { success: false, error: 'Davet bağlantısı geçersiz veya eksik.' };
    }

    const supabase = await createClient();
    const adminSupabase = createAdminClient();

    const inviteResult = await adminSupabase
      .from('user_invites')
      .select('id, email, full_name, username, target_role, expires_at, accepted_at, invited_client_id')
      .eq('token', payload.data.inviteToken)
      .single();

    const inviteResultFallback =
      inviteResult.error?.code === '42703'
        ? await adminSupabase
            .from('user_invites')
            .select('id, email, target_role, expires_at, accepted_at')
            .eq('token', payload.data.inviteToken)
            .single()
        : inviteResult;

    const invite = inviteResultFallback.data;
    const inviteError = inviteResultFallback.error;

    if (inviteError || !invite) {
      return { success: false, error: 'Davet bulunamadı. Lütfen yöneticiden yeni davet isteyin.' };
    }

    const inviteExpired = new Date(invite.expires_at).getTime() < Date.now();
    if (invite.accepted_at || inviteExpired) {
      return { success: false, error: 'Davet süresi dolmuş veya daha önce kullanılmış.' };
    }

    if (invite.email.toLowerCase() !== payload.data.email.toLowerCase()) {
      return { success: false, error: 'Bu e-posta adresi ile bu davet eşleşmiyor.' };
    }

    const inviteUsername = ('username' in invite ? invite.username : null) ?? null;
    const submittedUsername = payload.data.username?.trim().toLowerCase() ?? null;

    if (inviteUsername && submittedUsername && inviteUsername !== submittedUsername) {
      return { success: false, error: 'Davet için tanımlı kullanıcı adı değiştirilemez.' };
    }

    const resolvedUsername = inviteUsername ?? submittedUsername;

    const { data: signupData, error: signupError } = await supabase.auth.signUp({
      email: payload.data.email,
      password: payload.data.password,
      options: {
        data: {
          full_name: payload.data.fullName,
        },
      },
    });

    if (signupError) {
      return { success: false, error: 'Kayıt işlemi başarısız oldu.' };
    }

    if (!signupData.user) {
      return {
        success: true,
        data: { redirectTo: '/login' },
      };
    }

    const role: UserRole = invite.target_role as UserRole;

    const profileUpsert = await supabase
      .from('profiles')
      .upsert({
        id: signupData.user.id,
        full_name: payload.data.fullName,
        username: resolvedUsername,
        role,
        avatar_url: null,
      })
      .select('id')
      .single();

    const profileUpsertFallback =
      profileUpsert.error?.code === '42703'
        ? await supabase
            .from('profiles')
            .upsert({
              id: signupData.user.id,
              full_name: payload.data.fullName,
              role,
              avatar_url: null,
            })
            .select('id')
            .single()
        : profileUpsert;

    const profileInsertError = profileUpsertFallback.error;

    if (profileInsertError) {
      if (profileInsertError.code === '23505') {
        return { success: false, error: 'Bu kullanıcı adı kullanımda. Lütfen farklı bir kullanıcı adı deneyin.' };
      }
      return { success: false, error: 'Hesap oluşturuldu ancak profil kaydı tamamlanamadı.' };
    }

    await adminSupabase
      .from('user_invites')
      .update({ accepted_at: new Date().toISOString(), accepted_by: signupData.user.id })
      .eq('id', invite.id);

    if (role === 'client') {
      const inviteRecord = invite as Record<string, unknown>;
      const invitedClientId =
        typeof inviteRecord.invited_client_id === 'string' && inviteRecord.invited_client_id.length > 0
          ? inviteRecord.invited_client_id
          : null;

      if (invitedClientId) {
        await adminSupabase
          .from('clients')
          .update({
            profile_id: signupData.user.id,
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', invitedClientId);
      } else {
        await adminSupabase
          .from('clients')
          .update({
            profile_id: signupData.user.id,
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('email', payload.data.email.toLowerCase())
          .is('deleted_at', null);
      }
    }

    const redirectTo = role === 'client' ? '/portal' : '/dashboard';

    return { success: true, data: { redirectTo } };
  } catch {
    return { success: false, error: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.' };
  }
}

export async function logoutAction(): Promise<ActionResult<null>> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      return { success: false, error: 'Çıkış işlemi başarısız oldu.' };
    }

    return { success: true, data: null };
  } catch {
    return { success: false, error: 'Beklenmeyen bir hata oluştu.' };
  }
}

export async function logoutAndRedirectAction(): Promise<void> {
  await logoutAction();
  redirect('/login');
}

export async function completeOnboardingAction(
  _previousState: ActionResult<{ redirectTo: string }> | undefined,
  formData: FormData
): Promise<ActionResult<{ redirectTo: string }>> {
  try {
    const payload = onboardingSchema.safeParse({
      fullName: formData.get('fullName'),
      role: formData.get('role'),
      nextPath: formData.get('nextPath') ?? undefined,
    });

    if (!payload.success) {
      return { success: false, error: 'Lütfen ad-soyad ve rol bilgisini girin.' };
    }

    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { success: false, error: 'Oturum doğrulanamadı. Lütfen tekrar giriş yapın.' };
    }

    const role: UserRole = payload.data.role;

    const { error: profileInsertError } = await supabase.from('profiles').upsert({
      id: user.id,
      full_name: payload.data.fullName,
      role,
      avatar_url: null,
    });

    if (profileInsertError) {
      return { success: false, error: 'Profil kaydı tamamlanamadı. Lütfen tekrar deneyin.' };
    }

    if (role === 'lawyer') {
      const { data: existingCases } = await supabase
        .from('cases')
        .select('id')
        .eq('lawyer_id', user.id)
        .limit(1);

      let demoCaseId = existingCases?.[0]?.id ?? null;

      if (!demoCaseId) {
        const { data: createdCase } = await supabase
          .from('cases')
          .insert({
            title: 'Demo Dosya (Örnek)',
            lawyer_id: user.id,
            client_id: null,
            status: 'open',
          })
          .select('id')
          .single();

        demoCaseId = createdCase?.id ?? null;
      }

      if (demoCaseId) {
        const { data: existingUpdates } = await supabase
          .from('case_updates')
          .select('id')
          .eq('case_id', demoCaseId)
          .limit(1);

        if (!existingUpdates || existingUpdates.length === 0) {
          await supabase.from('case_updates').insert({
            case_id: demoCaseId,
            message:
              'Hoş geldiniz! Bu örnek güncelleme, müvekkil portalında (paylaşım açıldığında) görünecek formatı temsil eder.',
            is_public_to_client: true,
            created_by: user.id,
          });
        }
      }
    }

    if (role === 'client') {
      const { data: existingAnnouncements } = await supabase
        .from('portal_announcements')
        .select('id')
        .eq('user_id', user.id)
        .limit(1);

      if (!existingAnnouncements || existingAnnouncements.length === 0) {
        await supabase.from('portal_announcements').insert({
          user_id: user.id,
          title: 'Portal Tanıtımı',
          body: 'Burada ofis tarafından sizinle paylaşılan dosyalar görünecek. Mesaj gönderebilir, güncellemeleri takip edebilirsiniz.',
        });
      }
    }

    const defaultRedirect = role === 'client' ? '/portal' : '/dashboard';
    const redirectTo =
      role === 'client'
        ? `/portal/otp?next=${encodeURIComponent(isSafeRedirect(payload.data.nextPath) ? payload.data.nextPath : '/portal')}`
        : isSafeRedirect(payload.data.nextPath)
          ? payload.data.nextPath
          : defaultRedirect;
    return { success: true, data: { redirectTo } };
  } catch {
    return { success: false, error: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.' };
  }
}
