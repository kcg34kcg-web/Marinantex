import type { AssistantTool } from '@/lib/tools/types';

interface MailItem {
  id: string;
  from: string;
  subject: string;
  priority: 'high' | 'medium' | 'low';
  receivedAt: string;
}

const demoMails: MailItem[] = [
  {
    id: 'mail-1',
    from: 'muhasebe@ofis.local',
    subject: 'Tahsilat takvimi onayı',
    priority: 'high',
    receivedAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
  },
  {
    id: 'mail-2',
    from: 'musteri@firma.com',
    subject: 'Sözleşme revizyonu hakkında',
    priority: 'high',
    receivedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
  {
    id: 'mail-3',
    from: 'baro@duyuru.org',
    subject: 'Seminer bilgilendirmesi',
    priority: 'medium',
    receivedAt: new Date(Date.now() - 1000 * 60 * 220).toISOString(),
  },
];

function getProxyTarget() {
  const target =
    process.env.MAIL_WORKSPACE_PROXY_TARGET?.trim() ||
    process.env.MAIL_WORKSPACE_URL?.trim() ||
    'http://localhost:3001';
  return target.replace(/\/$/, '');
}

function getLoginPayload() {
  return {
    email: process.env.MAIL_WORKSPACE_LOGIN_EMAIL?.trim() || 'owner@demo.lexoffice.ai',
    password: process.env.MAIL_WORKSPACE_LOGIN_PASSWORD?.trim() || 'ChangeMe123!',
    tenantSlug: process.env.MAIL_WORKSPACE_TENANT_SLUG?.trim() || 'demo-hukuk',
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractSetCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    return setCookies.map((value) => value.split(';')[0]).join('; ');
  }

  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) {
    return '';
  }

  return setCookie
    .split(',')
    .map((part) => part.split(';')[0])
    .join('; ');
}

function guessPriority(subject: string) {
  const normalized = subject.toLocaleLowerCase('tr-TR');
  if (
    normalized.includes('acil') ||
    normalized.includes('urgent') ||
    normalized.includes('önemli') ||
    normalized.includes('odeme') ||
    normalized.includes('ödeme')
  ) {
    return 'high' as const;
  }
  if (normalized.includes('bilgi') || normalized.includes('hatırlatma') || normalized.includes('duyuru')) {
    return 'low' as const;
  }
  return 'medium' as const;
}

function parseThreadRows(payload: unknown): MailItem[] {
  const asRecord = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const candidateLists = [
    asRecord.items,
    asRecord.threads,
    asRecord.data,
    typeof asRecord.result === 'object' && asRecord.result !== null
      ? (asRecord.result as Record<string, unknown>).items
      : undefined,
  ];

  const rows = candidateLists.find((value) => Array.isArray(value));
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((item) => {
      const row = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null;
      if (!row) {
        return null;
      }

      const id =
        (typeof row.id === 'string' && row.id) ||
        (typeof row.threadId === 'string' && row.threadId) ||
        crypto.randomUUID();
      const subject =
        (typeof row.subject === 'string' && row.subject.trim()) ||
        (typeof row.title === 'string' && row.title.trim()) ||
        'Konu bilgisi yok';
      const from =
        (typeof row.from === 'string' && row.from.trim()) ||
        (typeof row.fromAddress === 'string' && row.fromAddress.trim()) ||
        (typeof row.sender === 'string' && row.sender.trim()) ||
        'Bilinmiyor';

      const receivedAtRaw =
        (typeof row.receivedAt === 'string' && row.receivedAt) ||
        (typeof row.updatedAt === 'string' && row.updatedAt) ||
        (typeof row.lastMessageAt === 'string' && row.lastMessageAt) ||
        new Date().toISOString();

      const receivedAt = Number.isFinite(Date.parse(receivedAtRaw))
        ? new Date(receivedAtRaw).toISOString()
        : new Date().toISOString();

      const priority =
        row.priority === 'high' || row.priority === 'medium' || row.priority === 'low'
          ? row.priority
          : guessPriority(subject);

      return {
        id,
        from,
        subject,
        priority,
        receivedAt,
      };
    })
    .filter((item): item is MailItem => Boolean(item))
    .slice(0, 20);
}

async function fetchWorkspaceMails(): Promise<MailItem[] | null> {
  const proxyTarget = getProxyTarget();

  try {
    const loginResponse = await fetchWithTimeout(
      `${proxyTarget}/mail-workspace/api/v1/auth/login`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(getLoginPayload()),
      },
      5000,
    );

    if (!loginResponse.ok) {
      return null;
    }

    const cookie = extractSetCookie(loginResponse);
    if (!cookie) {
      return null;
    }

    const candidates = [
      `${proxyTarget}/mail-workspace/api/v1/mail/threads?view=inbox&limit=20`,
      `${proxyTarget}/mail-workspace/api/v1/mail/threads?folder=inbox&limit=20`,
    ];

    for (const endpoint of candidates) {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: 'GET',
          headers: {
            cookie,
          },
        },
        5000,
      );
      if (!response.ok) {
        continue;
      }

      const payload = await response.json().catch(() => null);
      const parsed = parseThreadRows(payload);
      if (parsed.length > 0) {
        return parsed;
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function resolveMailItems() {
  const live = await fetchWorkspaceMails();
  if (live && live.length > 0) {
    return {
      mails: live,
      source: 'workspace' as const,
    };
  }

  return {
    mails: demoMails,
    source: 'demo' as const,
  };
}

export const mailSummaryTool: AssistantTool = {
  name: 'mail.summary',
  label: 'Mailleri özetle',
  description: 'Gelen kutusunu önem sırasına göre özetler.',
  requiresConfirmation: false,
  async preview() {
    const { mails, source } = await resolveMailItems();
    const high = mails.filter((item) => item.priority === 'high');
    return {
      summary: `Öncelikli ${high.length} mail bulundu.${source === 'workspace' ? '' : ' (Demo veri)'}`,
      preview: {
        total: mails.length,
        highPriority: high,
        source,
      },
      requiresConfirmation: false,
    };
  },
  async run() {
    const { mails, source } = await resolveMailItems();
    const high = mails.filter((item) => item.priority === 'high');
    return {
      summary: `${mails.length} mail tarandı, ${high.length} tanesi kritik.${source === 'workspace' ? '' : ' (Demo veri)'}`,
      output: {
        mails,
        source,
      },
    };
  },
};
