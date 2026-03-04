import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { RagFeatureFlagsV1 } from '@/types';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { createClient } from '@/utils/supabase/server';

const FLAG_KEYS = [
  'strict_grounding_v2',
  'tier_selector_ui',
  'router_hybrid_v3',
  'save_targets_v2',
  'client_translator_draft',
  'memory_dashboard_v1',
] as const;

type FlagKey = (typeof FLAG_KEYS)[number];

const DEFAULT_FLAGS: RagFeatureFlagsV1 = {
  strict_grounding_v2: true,
  tier_selector_ui: true,
  router_hybrid_v3: true,
  save_targets_v2: true,
  client_translator_draft: true,
  memory_dashboard_v1: false,
};

const memoryToggleSchema = z.object({
  memory_writeback_enabled: z.boolean(),
});

const factUpdateSchema = z
  .object({
    kind: z.literal('fact'),
    id: z.string().uuid(),
    fact_text: z.string().min(1).max(2000).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .refine(
    (payload) => payload.fact_text !== undefined || payload.confidence !== undefined,
    'fact_text veya confidence alanlarindan en az biri gerekli.',
  );

const preferenceUpdateSchema = z
  .object({
    kind: z.literal('preference'),
    id: z.string().uuid(),
    pref_key: z.string().min(1).max(120).optional(),
    pref_value: z.string().min(1).max(2000).optional(),
  })
  .refine(
    (payload) => payload.pref_key !== undefined || payload.pref_value !== undefined,
    'pref_key veya pref_value alanlarindan en az biri gerekli.',
  );

const createSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fact'),
    fact_text: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1).optional(),
    source_type: z.string().min(1).max(64).optional(),
    source_message_id: z.string().uuid().optional(),
    source_saved_output_id: z.string().uuid().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('preference'),
    pref_key: z.string().min(1).max(120),
    pref_value: z.string().min(1).max(2000),
    metadata: z.record(z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('edge'),
    from_fact_id: z.string().uuid(),
    to_fact_id: z.string().uuid(),
    relation_type: z.string().min(1).max(120).optional(),
    weight: z.number().min(0).max(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
]);

function envOverride(flag: FlagKey): boolean | null {
  const envName = `NEXT_PUBLIC_FEATURE_${flag.toUpperCase()}`;
  const raw = process.env[envName];
  if (raw === undefined) return null;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'no', 'disabled'].includes(normalized)) return false;
  return null;
}

async function resolveFeatureFlags(
  bureauId: string | null,
): Promise<RagFeatureFlagsV1> {
  const supabase = await createClient();
  const merged: RagFeatureFlagsV1 = { ...DEFAULT_FLAGS };

  const [globalFlagsResult, bureauFlagsResult] = await Promise.all([
    supabase
      .from('ai_feature_flags')
      .select('flag_key, is_enabled')
      .is('bureau_id', null)
      .in('flag_key', [...FLAG_KEYS]),
    bureauId
      ? supabase
          .from('ai_feature_flags')
          .select('flag_key, is_enabled')
          .eq('bureau_id', bureauId)
          .in('flag_key', [...FLAG_KEYS])
      : Promise.resolve({ data: [] as Array<{ flag_key: string; is_enabled: boolean }> }),
  ]);

  for (const row of globalFlagsResult.data ?? []) {
    const key = row.flag_key as FlagKey;
    if (FLAG_KEYS.includes(key)) {
      merged[key] = Boolean(row.is_enabled);
    }
  }

  for (const row of bureauFlagsResult.data ?? []) {
    const key = row.flag_key as FlagKey;
    if (FLAG_KEYS.includes(key)) {
      merged[key] = Boolean(row.is_enabled);
    }
  }

  for (const key of FLAG_KEYS) {
    const override = envOverride(key);
    if (override !== null) {
      merged[key] = override;
    }
  }

  return merged;
}

async function resolveContext() {
  const supabase = await createClient();
  let context;
  try {
    context = await resolveBureauContext(supabase);
  } catch {
    return { error: NextResponse.json({ error: 'Oturum bulunamadi.' }, { status: 401 }) };
  }
  if (!context.bureauId) {
    return { error: NextResponse.json({ error: 'Buro baglami bulunamadi.' }, { status: 401 }) };
  }

  const flags = await resolveFeatureFlags(context.bureauId);
  return {
    supabase,
    userId: context.userId,
    bureauId: context.bureauId,
    flags,
  };
}

function memoryDisabledPayload() {
  return {
    feature_enabled: false,
    memory_writeback_enabled: false,
    facts: [],
    preferences: [],
    edges: [],
  };
}

export async function GET() {
  const ctx = await resolveContext();
  if ('error' in ctx) return ctx.error;

  if (!ctx.flags.memory_dashboard_v1) {
    return NextResponse.json(memoryDisabledPayload(), { status: 200 });
  }

  const [settingsResult, factsResult, preferencesResult, edgesResult] = await Promise.all([
    ctx.supabase
      .from('ai_user_settings')
      .select('memory_writeback_enabled')
      .eq('user_id', ctx.userId)
      .eq('bureau_id', ctx.bureauId)
      .maybeSingle(),
    ctx.supabase
      .from('memory_facts')
      .select('id, fact_text, confidence, source_type, created_at, updated_at')
      .eq('user_id', ctx.userId)
      .eq('bureau_id', ctx.bureauId)
      .order('created_at', { ascending: false })
      .limit(30),
    ctx.supabase
      .from('memory_preferences')
      .select('id, pref_key, pref_value, created_at, updated_at')
      .eq('user_id', ctx.userId)
      .eq('bureau_id', ctx.bureauId)
      .order('updated_at', { ascending: false })
      .limit(30),
    ctx.supabase
      .from('memory_edges')
      .select('id, from_fact_id, to_fact_id, relation_type, weight, created_at')
      .eq('user_id', ctx.userId)
      .eq('bureau_id', ctx.bureauId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (factsResult.error || preferencesResult.error || edgesResult.error) {
    return NextResponse.json(
      { error: 'Memory verileri okunamadi.' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      feature_enabled: true,
      memory_writeback_enabled: Boolean(settingsResult.data?.memory_writeback_enabled),
      facts: factsResult.data ?? [],
      preferences: preferencesResult.data ?? [],
      edges: edgesResult.data ?? [],
    },
    { status: 200 },
  );
}

export async function PATCH(request: Request) {
  const ctx = await resolveContext();
  if ('error' in ctx) return ctx.error;

  if (!ctx.flags.memory_dashboard_v1) {
    return NextResponse.json({ error: 'Memory dashboard pasif.' }, { status: 403 });
  }

  const body = await request.json();
  const togglePayload = memoryToggleSchema.safeParse(body);
  if (togglePayload.success) {
    const { error } = await ctx.supabase.from('ai_user_settings').upsert(
      {
        user_id: ctx.userId,
        bureau_id: ctx.bureauId,
        memory_writeback_enabled: togglePayload.data.memory_writeback_enabled,
      },
      { onConflict: 'user_id' },
    );

    if (error) {
      return NextResponse.json({ error: 'Memory ayari guncellenemedi.' }, { status: 503 });
    }

    return NextResponse.json(
      {
        success: true,
        memory_writeback_enabled: togglePayload.data.memory_writeback_enabled,
      },
      { status: 200 },
    );
  }

  const patchPayload = z.union([factUpdateSchema, preferenceUpdateSchema]).safeParse(body);
  if (!patchPayload.success) {
    return NextResponse.json(
      { error: patchPayload.error.issues.map((issue) => issue.message).join(' ') },
      { status: 400 },
    );
  }

  if (patchPayload.data.kind === 'fact') {
    const updatePayload: Record<string, unknown> = {};
    if (patchPayload.data.fact_text !== undefined) updatePayload.fact_text = patchPayload.data.fact_text;
    if (patchPayload.data.confidence !== undefined) updatePayload.confidence = patchPayload.data.confidence;

    const { data, error } = await ctx.supabase
      .from('memory_facts')
      .update(updatePayload)
      .eq('id', patchPayload.data.id)
      .eq('user_id', ctx.userId)
      .eq('bureau_id', ctx.bureauId)
      .select('id, fact_text, confidence, source_type, created_at, updated_at')
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: 'Memory fact guncellenemedi.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, item: data }, { status: 200 });
  }

  const preferenceUpdatePayload: Record<string, unknown> = {};
  if (patchPayload.data.pref_key !== undefined) preferenceUpdatePayload.pref_key = patchPayload.data.pref_key;
  if (patchPayload.data.pref_value !== undefined) preferenceUpdatePayload.pref_value = patchPayload.data.pref_value;

  const { data, error } = await ctx.supabase
    .from('memory_preferences')
    .update(preferenceUpdatePayload)
    .eq('id', patchPayload.data.id)
    .eq('user_id', ctx.userId)
    .eq('bureau_id', ctx.bureauId)
    .select('id, pref_key, pref_value, created_at, updated_at')
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'Memory preference guncellenemedi.' }, { status: 404 });
  }

  return NextResponse.json({ success: true, item: data }, { status: 200 });
}

export async function POST(request: Request) {
  const ctx = await resolveContext();
  if ('error' in ctx) return ctx.error;

  if (!ctx.flags.memory_dashboard_v1) {
    return NextResponse.json({ error: 'Memory dashboard pasif.' }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((issue) => issue.message).join(' ') },
      { status: 400 },
    );
  }

  if (parsed.data.kind === 'fact') {
    const { data, error } = await ctx.supabase
      .from('memory_facts')
      .insert({
        bureau_id: ctx.bureauId,
        user_id: ctx.userId,
        fact_text: parsed.data.fact_text,
        confidence: parsed.data.confidence ?? 0.7,
        source_type: parsed.data.source_type ?? 'user_input',
        source_message_id: parsed.data.source_message_id ?? null,
        source_saved_output_id: parsed.data.source_saved_output_id ?? null,
        metadata: parsed.data.metadata ?? {},
      })
      .select('id, fact_text, confidence, source_type, created_at, updated_at')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Memory fact eklenemedi.' }, { status: 503 });
    }

    return NextResponse.json({ success: true, item: data }, { status: 200 });
  }

  if (parsed.data.kind === 'preference') {
    const { data, error } = await ctx.supabase
      .from('memory_preferences')
      .upsert(
        {
          bureau_id: ctx.bureauId,
          user_id: ctx.userId,
          pref_key: parsed.data.pref_key,
          pref_value: parsed.data.pref_value,
          metadata: parsed.data.metadata ?? {},
        },
        { onConflict: 'user_id,pref_key' },
      )
      .select('id, pref_key, pref_value, created_at, updated_at')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Memory preference kaydedilemedi.' }, { status: 503 });
    }

    return NextResponse.json({ success: true, item: data }, { status: 200 });
  }

  const { data, error } = await ctx.supabase
    .from('memory_edges')
    .insert({
      bureau_id: ctx.bureauId,
      user_id: ctx.userId,
      from_fact_id: parsed.data.from_fact_id,
      to_fact_id: parsed.data.to_fact_id,
      relation_type: parsed.data.relation_type ?? 'related',
      weight: parsed.data.weight ?? 0.5,
      metadata: parsed.data.metadata ?? {},
    })
    .select('id, from_fact_id, to_fact_id, relation_type, weight, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: 'Memory edge eklenemedi.' }, { status: 503 });
  }

  return NextResponse.json({ success: true, item: data }, { status: 200 });
}

export async function DELETE(request: Request) {
  const ctx = await resolveContext();
  if ('error' in ctx) return ctx.error;

  if (!ctx.flags.memory_dashboard_v1) {
    return NextResponse.json({ error: 'Memory dashboard pasif.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const id = url.searchParams.get('id');

  if (!kind || !id) {
    return NextResponse.json({ error: 'kind ve id zorunludur.' }, { status: 400 });
  }

  if (!['fact', 'preference', 'edge'].includes(kind)) {
    return NextResponse.json({ error: 'Gecersiz kind degeri.' }, { status: 400 });
  }

  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'id UUID formatinda olmali.' }, { status: 400 });
  }

  const table =
    kind === 'fact'
      ? 'memory_facts'
      : kind === 'preference'
        ? 'memory_preferences'
        : 'memory_edges';

  const { error } = await ctx.supabase
    .from(table)
    .delete()
    .eq('id', id)
    .eq('user_id', ctx.userId)
    .eq('bureau_id', ctx.bureauId);

  if (error) {
    return NextResponse.json({ error: 'Memory kaydi silinemedi.' }, { status: 503 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
