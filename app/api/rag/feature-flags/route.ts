import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { rolloutEnabled } from '@/app/api/rag/_lib/rollout';

const FLAG_KEYS = [
  'strict_grounding_v2',
  'tier_selector_ui',
  'router_hybrid_v3',
  'save_targets_v2',
  'client_translator_draft',
  'memory_dashboard_v1',
  'rag_v3_single_pipeline_enforced',
] as const;

type FlagKey = (typeof FLAG_KEYS)[number];

type FlagMap = Record<FlagKey, boolean>;

const DEFAULT_FLAGS: FlagMap = {
  strict_grounding_v2: true,
  tier_selector_ui: true,
  router_hybrid_v3: true,
  save_targets_v2: true,
  client_translator_draft: true,
  memory_dashboard_v1: false,
  rag_v3_single_pipeline_enforced: false,
};

function withEnvOverrides(base: FlagMap): FlagMap {
  const merged: FlagMap = { ...base };
  for (const key of FLAG_KEYS) {
    const override = envOverride(key);
    if (override !== null) merged[key] = override;
  }
  return merged;
}

function envOverride(flag: FlagKey): boolean | null {
  const envName = `NEXT_PUBLIC_FEATURE_${flag.toUpperCase()}`;
  const raw = process.env[envName];
  if (raw === undefined) return null;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'no', 'disabled'].includes(normalized)) return false;
  return null;
}

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Oturum bulunamadi.' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('bureau_id')
    .eq('id', user.id)
    .maybeSingle();

  const bureauId = profile?.bureau_id ?? null;
  if (profileError || !bureauId) {
    return NextResponse.json(
      { flags: withEnvOverrides(DEFAULT_FLAGS), source: 'defaults' },
      { status: 200 },
    );
  }

  const [globalFlagsResult, bureauFlagsResult] = await Promise.all([
    supabase
      .from('ai_feature_flags')
      .select('flag_key, is_enabled, rollout_percentage')
      .is('bureau_id', null)
      .in('flag_key', [...FLAG_KEYS]),
    supabase
      .from('ai_feature_flags')
      .select('flag_key, is_enabled, rollout_percentage')
      .eq('bureau_id', bureauId)
      .in('flag_key', [...FLAG_KEYS]),
  ]);

  const merged: FlagMap = { ...DEFAULT_FLAGS };

  for (const row of globalFlagsResult.data ?? []) {
    const key = row.flag_key as FlagKey;
    if (FLAG_KEYS.includes(key)) {
      merged[key] = rolloutEnabled({
        flagKey: key,
        isEnabled: Boolean(row.is_enabled),
        rolloutPercentage: typeof row.rollout_percentage === 'number' ? row.rollout_percentage : null,
        actorId: user.id,
      });
    }
  }

  for (const row of bureauFlagsResult.data ?? []) {
    const key = row.flag_key as FlagKey;
    if (FLAG_KEYS.includes(key)) {
      merged[key] = rolloutEnabled({
        flagKey: key,
        isEnabled: Boolean(row.is_enabled),
        rolloutPercentage: typeof row.rollout_percentage === 'number' ? row.rollout_percentage : null,
        actorId: user.id,
      });
    }
  }

  const finalFlags = withEnvOverrides(merged);

  return NextResponse.json(
    {
      flags: finalFlags,
      source:
        globalFlagsResult.error || bureauFlagsResult.error ? 'defaults' : 'database',
    },
    { status: 200 },
  );
}
