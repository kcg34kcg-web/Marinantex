import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { publishOfficeNotification } from '@/lib/office/notifications';
import { logDashboardAudit } from '@/lib/dashboard/audit';

const NEWS_SHARE_THREAD_TITLE = 'Haber Paylasimlari';
const MAX_SHARE_SENTENCE_LENGTH = 280;
const MAX_SHARE_ACTION_LENGTH = 180;

const CATEGORY_LABELS: Record<'Mevzuat' | 'Duyuru' | 'Ictihat' | 'Sektorel', string> = {
  Mevzuat: 'Mevzuat',
  Duyuru: 'Duyuru',
  Ictihat: 'Ictihat',
  Sektorel: 'Sektorel',
};

const SEVERITY_LABELS: Record<'kritik' | 'orta' | 'bilgi', string> = {
  kritik: 'Kritik',
  orta: 'Orta',
  bilgi: 'Bilgi',
};

const WORKSPACE_LABELS: Record<'icra' | 'is' | 'kira' | 'ceza' | 'kvkk' | 'finans' | 'eticaret' | 'enerji', string> = {
  icra: 'Icra',
  is: 'Is',
  kira: 'Kira',
  ceza: 'Ceza',
  kvkk: 'KVKK',
  finans: 'Finans',
  eticaret: 'E-Ticaret',
  enerji: 'Enerji',
};

const shareSchema = z.object({
  newsId: z.string().min(3).max(180),
  title: z.string().min(1).max(500),
  source: z.string().min(1).max(200),
  sourceUrl: z.string().url(),
  summary: z.string().min(1).max(5000),
  detailText: z.string().min(1).max(12000),
  publishedAt: z.string().min(4).max(80),
  category: z.enum(['Mevzuat', 'Duyuru', 'Ictihat', 'Sektorel']).optional(),
  severity: z.enum(['kritik', 'orta', 'bilgi']).optional(),
  workspaces: z.array(z.enum(['icra', 'is', 'kira', 'ceza', 'kvkk', 'finans', 'eticaret', 'enerji'])).max(8).optional(),
  actionDraft: z.array(z.string().min(1).max(240)).max(6).optional(),
  impactCases: z
    .array(
      z.object({
        title: z.string().min(1).max(240),
        reason: z.string().min(1).max(260),
      }),
    )
    .max(6)
    .optional(),
  tags: z.array(z.string().min(1).max(60)).max(10).optional(),
});

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, maxLength: number) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(maxLength - 3, 0))}...`;
}

function ensureSentencePunctuation(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return '';
  }
  if (/[.!?]$/.test(normalized)) {
    return normalized;
  }
  return `${normalized}.`;
}

function splitIntoSentences(text: string) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter((sentence) => sentence.length > 0);
}

function pickTopSentences(primary: string, secondary: string) {
  const all = [...splitIntoSentences(primary), ...splitIntoSentences(secondary)];
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const sentence of all) {
    const key = normalizeWhitespace(sentence).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(truncate(ensureSentencePunctuation(sentence), MAX_SHARE_SENTENCE_LENGTH));
    if (unique.length >= 3) {
      break;
    }
  }

  if (unique.length > 0) {
    return unique;
  }

  return [truncate(ensureSentencePunctuation(primary), MAX_SHARE_SENTENCE_LENGTH)];
}

function formatShareMessage(payload: z.infer<typeof shareSchema>) {
  const summaryLines = pickTopSentences(payload.summary, payload.detailText);
  const actionLines = (payload.actionDraft ?? [])
    .map((entry) => truncate(ensureSentencePunctuation(entry), MAX_SHARE_ACTION_LENGTH))
    .filter((entry) => entry.length > 0)
    .slice(0, 3);
  const impactLines = (payload.impactCases ?? [])
    .map((item) => `${truncate(item.title, 90)} | ${truncate(item.reason, 110)}`)
    .slice(0, 3);
  const workspaceLabels = (payload.workspaces ?? []).map((workspace) => WORKSPACE_LABELS[workspace]).slice(0, 5);
  const tags = (payload.tags ?? []).slice(0, 6);
  const categoryLabel = payload.category ? CATEGORY_LABELS[payload.category] : 'Belirtilmedi';
  const severityLabel = payload.severity ? SEVERITY_LABELS[payload.severity] : 'Belirtilmedi';

  const lines = [
    '[Haber Koprusu]',
    `Baslik: ${payload.title}`,
    `Kategori / Oncelik: ${categoryLabel} / ${severityLabel}`,
    `Kaynak: ${payload.source}`,
    `Yayin: ${payload.publishedAt}`,
    `Calisma Alanlari: ${workspaceLabels.length > 0 ? workspaceLabels.join(', ') : 'Belirtilmedi'}`,
    `Etiketler: ${tags.length > 0 ? tags.join(', ') : 'Belirtilmedi'}`,
    '',
    'Ozet:',
    ...summaryLines.map((line) => `- ${line}`),
  ];

  if (actionLines.length > 0) {
    lines.push('', 'Onerilen Aksiyonlar:', ...actionLines.map((line) => `- ${line}`));
  }

  if (impactLines.length > 0) {
    lines.push('', 'Etkilenebilecek Dosyalar:', ...impactLines.map((line) => `- ${line}`));
  }

  lines.push(
    '',
    `Kaynak baglantisi: ${payload.sourceUrl}`,
  );
  lines.push(`News kaydi: ${payload.newsId}`);

  return lines.join('\n');
}

async function ensureNewsBridgeThread(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const existingResult = await admin
    .from('office_threads')
    .select('id')
    .eq('thread_type', 'broadcast')
    .eq('title', NEWS_SHARE_THREAD_TITLE)
    .eq('is_archived', false)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingResult.error) {
    throw new Error('Kopru sohbeti okunamadi.');
  }

  if (existingResult.data?.id) {
    return existingResult.data.id;
  }

  const createResult = await admin
    .from('office_threads')
    .insert({
      title: NEWS_SHARE_THREAD_TITLE,
      thread_type: 'broadcast',
      target_role: null,
      created_by: userId,
      is_archived: false,
      last_message_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (createResult.error || !createResult.data?.id) {
    throw new Error('Kopru sohbeti olusturulamadi.');
  }

  const threadId = createResult.data.id;

  const membersResult = await admin.from('profiles').select('id').in('role', ['lawyer', 'assistant']);
  if (membersResult.error) {
    throw new Error('Ekip uyeleri okunamadi.');
  }

  const membershipRows = (membersResult.data ?? []).map((member) => ({
    thread_id: threadId,
    user_id: member.id,
  }));

  if (membershipRows.length > 0) {
    const insertMembersResult = await admin
      .from('office_thread_members')
      .upsert(membershipRows, { onConflict: 'thread_id,user_id', ignoreDuplicates: true });
    if (insertMembersResult.error) {
      throw new Error('Kopru sohbet uyeleri eklenemedi.');
    }
  }

  return threadId;
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = shareSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Gecersiz haber paylasim verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  try {
    const threadId = await ensureNewsBridgeThread(admin, access.userId);
    const body = formatShareMessage(payload);
    const now = new Date().toISOString();

    const insertMessageResult = await admin
      .from('office_messages')
      .insert({
        thread_id: threadId,
        sender_id: access.userId,
        body,
        metadata: {
          origin: 'dashboard_news_share',
          news_id: payload.newsId,
          source_url: payload.sourceUrl,
          category: payload.category ?? null,
          severity: payload.severity ?? null,
          tags: payload.tags ?? [],
          workspaces: payload.workspaces ?? [],
        },
      })
      .select('id')
      .single();

    if (insertMessageResult.error || !insertMessageResult.data) {
      return Response.json({ error: 'Haber ekip sohbetine aktarilamadi.' }, { status: 500 });
    }

    await admin.from('office_threads').update({ last_message_at: now }).eq('id', threadId);
    publishOfficeNotification({
      type: 'risk_communication',
      category: 'messages',
      title: 'Haber ekip kanalina paylasildi',
      detail: payload.title.length > 120 ? `${payload.title.slice(0, 117)}...` : payload.title,
      actionUrl: `/office?tab=team&threadId=${threadId}`,
      actionLabel: 'Ekibi Ac',
      bureauId: access.bureauId,
    });

    await logDashboardAudit(admin, {
      actorUserId: access.userId,
      action: 'dashboard_news_shared_to_team',
      entityType: 'office_message',
      entityId: insertMessageResult.data.id,
      metadata: {
        threadId,
        newsId: payload.newsId,
        sourceUrl: payload.sourceUrl,
        category: payload.category ?? null,
        severity: payload.severity ?? null,
        workspaces: payload.workspaces ?? [],
      },
    });

    return Response.json({
      ok: true,
      threadId,
      redirectUrl: `/office?tab=team&threadId=${threadId}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Haber paylasim koprusu kurulurken hata olustu.';
    return Response.json({ error: message }, { status: 500 });
  }
}
