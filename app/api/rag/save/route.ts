/**
 * /api/rag/save - Next.js proxy to FastAPI /api/v1/rag/save.
 *
 * Keeps bureau/user headers and service URL out of the browser.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ClientAction, ResponseType, SaveMode, SaveTarget } from '@/types';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { fetchRagBackend, getRagBackendForLogs } from '@/app/api/rag/_lib/rag-backend';
import { createClient } from '@/utils/supabase/server';

const SAVE_FLAG_KEYS = ['save_targets_v2', 'client_translator_draft'] as const;
type SaveFlagKey = (typeof SAVE_FLAG_KEYS)[number];

const DEFAULT_SAVE_FLAGS: Record<SaveFlagKey, boolean> = {
  save_targets_v2: true,
  client_translator_draft: true,
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function pickErrorMessage(body: unknown): string {
  const bodyObj = asObject(body);
  if (!bodyObj) return 'Kaydetme istegi basarisiz oldu.';

  const detail = bodyObj.detail;
  if (typeof detail === 'string') return detail;
  if (typeof bodyObj.error === 'string') return bodyObj.error;
  if (typeof bodyObj.message === 'string') return bodyObj.message;

  const detailObj = asObject(detail);
  if (typeof detailObj?.message === 'string') return detailObj.message;

  return 'Kaydetme istegi basarisiz oldu.';
}

function envOverride(flag: SaveFlagKey): boolean | null {
  const envName = `NEXT_PUBLIC_FEATURE_${flag.toUpperCase()}`;
  const raw = process.env[envName];
  if (raw === undefined) return null;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'no', 'disabled'].includes(normalized)) return false;
  return null;
}

async function resolveSaveFlags(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bureauId: string | null,
): Promise<Record<SaveFlagKey, boolean>> {
  const [globalResult, bureauResult] = await Promise.all([
    supabase
      .from('ai_feature_flags')
      .select('flag_key, is_enabled')
      .is('bureau_id', null)
      .in('flag_key', [...SAVE_FLAG_KEYS]),
    bureauId
      ? supabase
          .from('ai_feature_flags')
          .select('flag_key, is_enabled')
          .eq('bureau_id', bureauId)
          .in('flag_key', [...SAVE_FLAG_KEYS])
      : Promise.resolve({ data: [] as Array<{ flag_key: string; is_enabled: boolean }> }),
  ]);

  const merged: Record<SaveFlagKey, boolean> = { ...DEFAULT_SAVE_FLAGS };
  for (const row of globalResult.data ?? []) {
    const key = row.flag_key as SaveFlagKey;
    if (SAVE_FLAG_KEYS.includes(key)) merged[key] = Boolean(row.is_enabled);
  }
  for (const row of bureauResult.data ?? []) {
    const key = row.flag_key as SaveFlagKey;
    if (SAVE_FLAG_KEYS.includes(key)) merged[key] = Boolean(row.is_enabled);
  }
  for (const key of SAVE_FLAG_KEYS) {
    const override = envOverride(key);
    if (override !== null) merged[key] = override;
  }
  return merged;
}

const citationSchema = z.object({
  source_id: z.string().optional(),
  source_type: z.string().optional(),
  source_anchor: z.string().optional(),
  page_no: z.number().int().min(1).optional(),
  char_start: z.number().int().min(0).optional(),
  char_end: z.number().int().min(0).optional(),
  source_hash: z.string().optional(),
  doc_version: z.string().optional(),
  citation_text: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const requestSchema = z.object({
  answer: z.string().min(1, 'Kaydedilecek metin bos olamaz.'),
  response_type: z.nativeEnum(ResponseType).default(ResponseType.LEGAL_GROUNDED),
  title: z.string().max(300).optional(),
  output_type: z.string().min(1).max(64).optional(),
  output_kind: z.string().min(1).max(64).optional(),
  save_mode: z.nativeEnum(SaveMode).default(SaveMode.OUTPUT_WITH_THREAD_AND_SOURCES),
  save_target: z.nativeEnum(SaveTarget).default(SaveTarget.MY_FILES),
  thread_id: z.string().uuid().optional(),
  source_message_id: z.string().uuid().optional(),
  saved_from_message_id: z.string().uuid().optional(),
  parent_output_id: z.string().uuid().optional(),
  is_final: z.boolean().optional(),
  case_id: z.string().uuid().optional(),
  new_case_title: z.string().max(300).optional(),
  metadata: z.record(z.unknown()).optional(),
  citations: z.array(citationSchema).optional(),
  client_action: z.nativeEnum(ClientAction).default(ClientAction.NONE),
  client_id: z.string().uuid().optional(),
  client_draft_text: z.string().optional(),
  client_draft_title: z.string().max(300).optional(),
  client_metadata: z.record(z.unknown()).optional(),
});

export type RagSavePayload = z.infer<typeof requestSchema>;

export async function POST(req: Request) {
  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => issue.message).join(' ') },
        { status: 400 },
      );
    }

    const supabase = await createClient();

    let context;
    try {
      context = await resolveBureauContext(supabase);
    } catch {
      return NextResponse.json({ error: 'Oturum bulunamadi. Lutfen tekrar giris yapin.' }, { status: 401 });
    }

    const { bureauId, userId } = context;
    if (!bureauId) {
      return NextResponse.json({ error: 'Buro baglami bulunamadi. Profilinizi kontrol edin.' }, { status: 401 });
    }

    const flags = await resolveSaveFlags(supabase, bureauId);
    if (!flags.save_targets_v2) {
      return NextResponse.json(
        { error: 'Kaydetme akisi su an feature flag ile kapali.' },
        { status: 503 },
      );
    }

    if (
      parsed.data.client_action !== ClientAction.NONE
      && !flags.client_translator_draft
    ) {
      return NextResponse.json(
        { error: 'Muvekkil taslak ozelligi su an devre disi.' },
        { status: 403 },
      );
    }

    const upstream = await fetchRagBackend('/api/v1/rag/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bureau-ID': bureauId,
        'X-User-ID': userId,
      },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(60_000),
    });

    let body: unknown = null;
    try {
      body = await upstream.json();
    } catch {
      body = null;
    }

    if (!upstream.ok) {
      return NextResponse.json({ error: pickErrorMessage(body) }, { status: upstream.status });
    }

    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Kaydetme istegi zaman asimina ugradi. Lutfen tekrar deneyin.'
        : 'Kaydetme servisine baglanilamadi.';
    console.error('[RAG save proxy]', err, { backendCandidates: getRagBackendForLogs() });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
