import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ChatMode, ResponseType } from '@/types';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { resolveRequestedMatterId, validateMatterScope } from '@/app/api/rag/_lib/matter-policy';
import { createAdminClient } from '@/utils/supabase/admin';
import { createClient } from '@/utils/supabase/server';

const bootstrapSchema = z.object({
  action: z.literal('bootstrap'),
  thread_id: z.string().uuid().optional(),
  chat_mode: z.nativeEnum(ChatMode),
  case_id: z.string().uuid().optional(),
  user_message: z.string().min(1).max(10_000),
});

const appendAssistantSchema = z.object({
  action: z.literal('append_assistant'),
  thread_id: z.string().uuid(),
  assistant_message: z.string().min(1).max(50_000),
  response_type: z.nativeEnum(ResponseType),
  model_used: z.string().max(240).optional(),
  source_count: z.number().int().min(0).max(300).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const requestSchema = z.discriminatedUnion('action', [bootstrapSchema, appendAssistantSchema]);

type ThreadRequest = z.infer<typeof requestSchema>;

interface RequestContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  bureauId: string;
}

function logRouteException(route: string, method: string, error: unknown): void {
  console.error(
    JSON.stringify({
      event: 'rag_route_exception',
      route,
      method,
      error: error instanceof Error ? error.message : 'unknown_error',
    }),
  );
}

async function resolveContext(): Promise<RequestContext | NextResponse> {
  const supabase = await createClient();
  let context;
  try {
    context = await resolveBureauContext(supabase, { requireClaimMatch: true });
  } catch {
    return NextResponse.json({ error: 'Oturum bulunamadi.' }, { status: 401 });
  }

  if (!context.bureauId) {
    return NextResponse.json({ error: 'Buro baglami bulunamadi.' }, { status: 401 });
  }

  return {
    supabase,
    userId: context.userId,
    bureauId: context.bureauId,
  };
}

async function ensureThreadOwnership(
  ctx: RequestContext,
  threadId: string,
): Promise<{ id: string; case_id: string | null; chat_mode: string } | NextResponse> {
  const { data, error } = await ctx.supabase
    .from('ai_threads')
    .select('id, case_id, chat_mode')
    .eq('id', threadId)
    .eq('user_id', ctx.userId)
    .eq('bureau_id', ctx.bureauId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Thread bilgisi okunamadi.' }, { status: 503 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Thread bulunamadi veya erisim yetkiniz yok.' }, { status: 404 });
  }
  return data;
}

async function handleBootstrap(
  payload: Extract<ThreadRequest, { action: 'bootstrap' }>,
  ctx: RequestContext,
  requestHeaders: Headers,
) {
  let threadId = payload.thread_id ?? null;
  let threadCaseId = payload.case_id ?? null;

  if (threadId) {
    const thread = await ensureThreadOwnership(ctx, threadId);
    if (thread instanceof NextResponse) return thread;

    const matterScopeError = validateMatterScope({
      headers: requestHeaders,
      payloadMatterId: payload.case_id ?? null,
      resourceMatterId: thread.case_id,
      route: '/api/rag/thread',
    });
    if (matterScopeError) return matterScopeError;

    threadCaseId = thread.case_id;
    const shouldUpdateCase = payload.case_id && payload.case_id !== thread.case_id;
    const shouldUpdateMode = payload.chat_mode !== thread.chat_mode;

    if (shouldUpdateCase || shouldUpdateMode) {
      const updates: Record<string, unknown> = {};
      if (shouldUpdateCase) updates.case_id = payload.case_id;
      if (shouldUpdateMode) updates.chat_mode = payload.chat_mode;

      const { error: updateError } = await ctx.supabase
        .from('ai_threads')
        .update(updates)
        .eq('id', threadId)
        .eq('user_id', ctx.userId)
        .eq('bureau_id', ctx.bureauId);

      if (updateError) {
        return NextResponse.json({ error: 'Thread guncellenemedi.' }, { status: 503 });
      }
      threadCaseId = (updates.case_id as string | undefined) ?? thread.case_id;
    }
  } else {
    const matterScopeError = validateMatterScope({
      headers: requestHeaders,
      payloadMatterId: payload.case_id ?? null,
      route: '/api/rag/thread',
    });
    if (matterScopeError) return matterScopeError;
    const requestedMatterId = resolveRequestedMatterId(requestHeaders) ?? payload.case_id ?? null;
    const { data: createdThread, error: createThreadError } = await ctx.supabase
      .from('ai_threads')
      .insert({
        bureau_id: ctx.bureauId,
        user_id: ctx.userId,
        case_id: requestedMatterId,
        chat_mode: payload.chat_mode,
        title: payload.user_message.trim().slice(0, 120),
        metadata: {
          origin: 'hukuk_ai_chat',
          created_via: 'api/rag/thread',
        },
      })
      .select('id')
      .single();

    if (createThreadError || !createdThread) {
      return NextResponse.json({ error: 'Thread olusturulamadi.' }, { status: 503 });
    }

    threadId = createdThread.id;
    threadCaseId = requestedMatterId;
  }

  const { data: userMessage, error: userMessageError } = await ctx.supabase
    .from('ai_messages')
    .insert({
      thread_id: threadId,
      bureau_id: ctx.bureauId,
      role: 'user',
      content: payload.user_message.trim(),
      metadata: {
        origin: 'hukuk_ai_chat',
        chat_mode: payload.chat_mode,
      },
    })
    .select('id')
    .single();

  if (userMessageError || !userMessage) {
    return NextResponse.json({ error: 'Kullanici mesaji kaydedilemedi.' }, { status: 503 });
  }

  return NextResponse.json(
    {
      thread_id: threadId,
      user_message_id: userMessage.id,
      case_id: threadCaseId,
    },
    { status: 200 },
  );
}

async function handleAppendAssistant(
  payload: Extract<ThreadRequest, { action: 'append_assistant' }>,
  ctx: RequestContext,
  requestHeaders: Headers,
) {
  const ownership = await ensureThreadOwnership(ctx, payload.thread_id);
  if (ownership instanceof NextResponse) return ownership;

  const matterScopeError = validateMatterScope({
    headers: requestHeaders,
    resourceMatterId: ownership.case_id,
    route: '/api/rag/thread',
  });
  if (matterScopeError) return matterScopeError;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY eksik oldugu icin assistant mesaji kalici yazilamadi.' },
      { status: 503 },
    );
  }

  const { data: assistantMessage, error: assistantMessageError } = await admin
    .from('ai_messages')
    .insert({
      thread_id: payload.thread_id,
      bureau_id: ctx.bureauId,
      role: 'assistant',
      content: payload.assistant_message.trim(),
      response_type: payload.response_type,
      model_used: payload.model_used ?? null,
      source_count: payload.source_count ?? 0,
      metadata: {
        origin: 'hukuk_ai_chat',
        ...(payload.metadata ?? {}),
      },
    })
    .select('id')
    .single();

  if (assistantMessageError || !assistantMessage) {
    return NextResponse.json({ error: 'Assistant mesaji kaydedilemedi.' }, { status: 503 });
  }

  return NextResponse.json(
    {
      thread_id: payload.thread_id,
      assistant_message_id: assistantMessage.id,
    },
    { status: 200 },
  );
}

export async function POST(request: Request) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body JSON formatinda olmali.' }, { status: 400 });
    }

    const parsed = requestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => issue.message).join(' ') },
        { status: 400 },
      );
    }

    const ctx = await resolveContext();
    if (ctx instanceof NextResponse) return ctx;

    if (parsed.data.action === 'bootstrap') {
      return handleBootstrap(parsed.data, ctx, request.headers);
    }

    return handleAppendAssistant(parsed.data, ctx, request.headers);
  } catch (error) {
    logRouteException('/api/rag/thread', 'POST', error);
    return NextResponse.json({ error: 'Thread istegi islenemedi.' }, { status: 503 });
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await resolveContext();
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('thread_id')?.trim() ?? '';
    if (!threadId) {
      return NextResponse.json({ error: 'thread_id zorunludur.' }, { status: 400 });
    }

    const ownership = await ensureThreadOwnership(ctx, threadId);
    if (ownership instanceof NextResponse) return ownership;

    const matterScopeError = validateMatterScope({
      headers: request.headers,
      resourceMatterId: ownership.case_id,
      route: '/api/rag/thread',
    });
    if (matterScopeError) return matterScopeError;

    const { data, error } = await ctx.supabase
      .from('ai_messages')
      .select('id, role, content, response_type, model_used, source_count, created_at')
      .eq('thread_id', threadId)
      .eq('bureau_id', ctx.bureauId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: 'Thread mesajlari okunamadi.' }, { status: 503 });
    }

    return NextResponse.json(
      {
        thread_id: threadId,
        case_id: ownership.case_id,
        chat_mode: ownership.chat_mode,
        messages: data ?? [],
      },
      { status: 200 },
    );
  } catch (error) {
    logRouteException('/api/rag/thread', 'GET', error);
    return NextResponse.json({ error: 'Thread istegi islenemedi.' }, { status: 503 });
  }
}
