import { createAdminClient } from '@/utils/supabase/admin';
import { createClient } from '@/utils/supabase/server';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_RE.test(value.trim());
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function coerceInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

export interface ResolvedBureauContext {
  userId: string;
  bureauId: string | null;
  planTier: string;
  messagesToday: number | null;
  tokensUsedMonth: number | null;
}

export async function resolveBureauContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ResolvedBureauContext> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('AUTH_REQUIRED');
  }

  const profileResult = await supabase
    .from('profiles')
    .select('bureau_id')
    .eq('id', user.id)
    .maybeSingle();

  const profileBureauId = isUuid(profileResult.data?.bureau_id) ? profileResult.data.bureau_id : null;
  const metadataBureauId = isUuid(user.user_metadata?.bureau_id) ? user.user_metadata.bureau_id : null;
  let bureauId = profileBureauId ?? metadataBureauId;

  const planTierRaw = user.user_metadata?.plan_tier;
  const planTier = typeof planTierRaw === 'string' && planTierRaw.trim() ? planTierRaw.trim().toUpperCase() : 'FREE';
  const messagesToday = coerceInt(user.user_metadata?.messages_today);
  const tokensUsedMonth = coerceInt(user.user_metadata?.tokens_used_month);

  if (!bureauId) {
    try {
      const admin = createAdminClient();
      const emailLocal = String(user.email ?? '').split('@')[0] || 'kullanici';
      const slugBase = slugify(emailLocal) || 'kullanici';
      const trySlugs = [`${slugBase}-${user.id.slice(0, 8)}`, `${slugBase}-${Date.now().toString(36)}`];

      for (const slug of trySlugs) {
        const inserted = await admin
          .from('bureaus')
          .insert({
            name: `${emailLocal} Hukuk Burosu`,
            slug,
            plan_tier: 'FREE',
            is_active: true,
          })
          .select('id')
          .single();

        if (!inserted.error && inserted.data?.id) {
          bureauId = inserted.data.id;
          break;
        }
      }

      if (bureauId) {
        await admin.from('profiles').update({ bureau_id: bureauId }).eq('id', user.id);
      }
    } catch {
      // Service role key may be unavailable in local env; keep null.
    }
  } else if (!profileBureauId) {
    try {
      const admin = createAdminClient();
      await admin.from('profiles').update({ bureau_id: bureauId }).eq('id', user.id);
    } catch {
      // Non-fatal; context can still proceed with metadata-based bureau id.
    }
  }

  return {
    userId: user.id,
    bureauId,
    planTier,
    messagesToday,
    tokensUsedMonth,
  };
}

