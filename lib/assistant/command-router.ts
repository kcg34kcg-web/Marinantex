import type { AssistantActionPlan } from '@/types/assistant';

interface ResolveCommandInput {
  message: string;
  userName?: string | null;
}

interface RouteCommand {
  id: string;
  phrase: string;
  route: string;
  label: string;
}

interface ToolCommand {
  id: string;
  phrase: string;
  toolName: string;
  label: string;
  requiresQuery?: boolean;
  queryFallback?: string;
}

const ROUTE_COMMANDS: RouteCommand[] = [
  { id: 'route_mail_page', phrase: 'mail sayfasini ac', route: '/dashboard/mail', label: 'Mail' },
  { id: 'route_mail_open', phrase: 'maili ac', route: '/dashboard/mail', label: 'Mail' },
  { id: 'route_inbox_open', phrase: 'gelen kutusunu ac', route: '/dashboard/mail', label: 'Mail' },
  { id: 'route_dashboard_open', phrase: 'dashboard ac', route: '/dashboard', label: 'Dashboard' },
  { id: 'route_panel_open', phrase: 'ana paneli ac', route: '/dashboard', label: 'Dashboard' },
  { id: 'route_tasks_open', phrase: 'gorevlerimi ac', route: '/dashboard/tasks', label: 'Görevler' },
  { id: 'route_tasks_page', phrase: 'gorev sayfasini ac', route: '/dashboard/tasks', label: 'Görevler' },
  { id: 'route_calendar_open', phrase: 'takvimi ac', route: '/dashboard/calendar', label: 'Takvim' },
  { id: 'route_calendar_page', phrase: 'takvim sayfasini ac', route: '/dashboard/calendar', label: 'Takvim' },
  { id: 'route_cases_open', phrase: 'davalari ac', route: '/dashboard/cases', label: 'Davalar' },
  { id: 'route_case_page', phrase: 'dava sayfasini ac', route: '/dashboard/cases', label: 'Davalar' },
  { id: 'route_clients_open', phrase: 'muvekkilleri ac', route: '/dashboard/clients', label: 'Müvekkiller' },
  { id: 'route_client_page', phrase: 'muvekkil sayfasini ac', route: '/dashboard/clients', label: 'Müvekkiller' },
  { id: 'route_news_open', phrase: 'haberleri ac', route: '/dashboard/news', label: 'Haberler' },
  { id: 'route_news_page', phrase: 'haber sayfasini ac', route: '/dashboard/news', label: 'Haberler' },
  { id: 'route_profile_open', phrase: 'profilimi ac', route: '/dashboard/profile', label: 'Profil' },
  { id: 'route_settings_open', phrase: 'ayarlari ac', route: '/dashboard/settings', label: 'Ayarlar' },
  { id: 'route_office_open', phrase: 'ofis sayfasini ac', route: '/office', label: 'Ofis' },
  { id: 'route_hukukai_open', phrase: 'hukuk ai sayfasini ac', route: '/tools/hukuk-ai', label: 'Hukuk-AI' },
  { id: 'route_hukukai_short', phrase: 'hukuk ai ac', route: '/tools/hukuk-ai', label: 'Hukuk-AI' },
  { id: 'route_case_law_open', phrase: 'ictihat arama ac', route: '/tools/kaynak-ictihat-arama', label: 'İçtihat Arama' },
  { id: 'route_case_law_full', phrase: 'kaynak ictihat arama ac', route: '/tools/kaynak-ictihat-arama', label: 'İçtihat Arama' },
  { id: 'route_petition_open', phrase: 'dilekce sihirbazini ac', route: '/tools/dilekce-sihirbazi', label: 'Dilekçe Sihirbazı' },
  { id: 'route_calc_execution', phrase: 'icra hesaplama ac', route: '/tools/calculator/execution', label: 'İcra Hesaplama' },
  { id: 'route_calc_interest', phrase: 'faiz hesaplama ac', route: '/tools/calculator/interest', label: 'Faiz Hesaplama' },
  { id: 'route_calc_smm', phrase: 'smm hesaplama ac', route: '/tools/calculator/smm', label: 'SMM Hesaplama' },
  { id: 'route_time_billing_open', phrase: 'time billing ac', route: '/dashboard/time-billing', label: 'Time Billing' },
  { id: 'route_time_billing_tr', phrase: 'zaman faturalandirmayi ac', route: '/dashboard/time-billing', label: 'Time Billing' },
  { id: 'route_lounge_open', phrase: 'lounge ac', route: '/lounge', label: 'Lounge' },
  { id: 'route_social_open', phrase: 'sosyal akisi ac', route: '/social', label: 'Sosyal Akış' },
  { id: 'route_messages_open', phrase: 'mesajlari ac', route: '/messages', label: 'Mesajlar' },
  { id: 'route_portal_open', phrase: 'portali ac', route: '/portal', label: 'Portal' },
  { id: 'route_editor_open', phrase: 'editoru ac', route: '/editor', label: 'Editör' },
  { id: 'route_documents_open', phrase: 'belge merkezini ac', route: '/editor', label: 'Belge Merkezi' },
  { id: 'route_invites_open', phrase: 'davetleri ac', route: '/dashboard/invites', label: 'Davetler' },
  { id: 'route_corpus_open', phrase: 'corpus ac', route: '/dashboard/corpus', label: 'Corpus' },
];

const TOOL_COMMANDS: ToolCommand[] = [
  { id: 'tool_today_summary', phrase: 'bugunu ozetle', toolName: 'office.summary', label: 'Bugün Özeti' },
  { id: 'tool_office_summary', phrase: 'ofisi ozetle', toolName: 'office.summary', label: 'Ofis Özeti' },
  { id: 'tool_mail_summary', phrase: 'mailleri ozetle', toolName: 'mail.summary', label: 'Mail Özeti' },
  { id: 'tool_meetings_show', phrase: 'toplantilarimi goster', toolName: 'calendar.show', label: 'Toplantılar' },
  { id: 'tool_meetings_extract', phrase: 'toplantilarimdan gorev cikar', toolName: 'calendar.extract_tasks', label: 'Toplantıdan Görev Çıkar' },
  { id: 'tool_task_create', phrase: 'yeni gorev olustur', toolName: 'tasks.create', label: 'Yeni Görev' },
  { id: 'tool_task_add', phrase: 'gorev ekle', toolName: 'tasks.create', label: 'Yeni Görev' },
  { id: 'tool_task_today', phrase: 'bugunku gorevleri goster', toolName: 'tasks.today', label: 'Bugünkü Görevler' },
  { id: 'tool_task_overdue_a', phrase: 'geciken isleri listele', toolName: 'tasks.overdue', label: 'Geciken İşler' },
  { id: 'tool_task_overdue_b', phrase: 'gecikmis isleri listele', toolName: 'tasks.overdue', label: 'Geciken İşler' },
  { id: 'tool_file_find', phrase: 'dosya bul', toolName: 'files.search', label: 'Dosya Arama', requiresQuery: true, queryFallback: 'dosya' },
  { id: 'tool_file_search', phrase: 'dosya ara', toolName: 'files.search', label: 'Dosya Arama', requiresQuery: true, queryFallback: 'dosya' },
  { id: 'tool_important_work', phrase: 'onemli isleri listele', toolName: 'tasks.overdue', label: 'Önemli İşler' },
  { id: 'tool_commands_help', phrase: 'komutlari goster', toolName: 'assistant.help', label: 'Komut Yardımı' },
];

export const BUILTIN_ASSISTANT_COMMAND_COUNT = ROUTE_COMMANDS.length + TOOL_COMMANDS.length;

function normalizeForMatch(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a: string, b: string) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[m][n];
}

function similarity(a: string, b: string) {
  if (!a || !b) return 0;
  const distance = levenshteinDistance(a, b);
  const denominator = Math.max(a.length, b.length);
  return denominator === 0 ? 1 : 1 - distance / denominator;
}

function fuzzyPhraseIncluded(normalizedMessage: string, normalizedPhrase: string) {
  if (normalizedMessage.includes(normalizedPhrase)) {
    return true;
  }

  const messageTokens = normalizedMessage.split(' ').filter(Boolean);
  const phraseTokens = normalizedPhrase.split(' ').filter(Boolean);
  if (messageTokens.length === 0 || phraseTokens.length === 0) {
    return false;
  }

  const windowSize = phraseTokens.length;
  for (let i = 0; i <= messageTokens.length - windowSize; i += 1) {
    const candidate = messageTokens.slice(i, i + windowSize).join(' ');
    if (candidate === normalizedPhrase) {
      return true;
    }
    if (similarity(candidate, normalizedPhrase) >= 0.82) {
      return true;
    }
  }

  return false;
}

function hasNearToken(normalizedMessage: string, tokenCandidates: string[]) {
  const messageTokens = normalizedMessage.split(' ').filter(Boolean);
  for (const token of messageTokens) {
    for (const candidate of tokenCandidates) {
      if (token === candidate) {
        return true;
      }
      if (similarity(token, candidate) >= 0.72) {
        return true;
      }
    }
  }
  return false;
}

function buildAddressPrefix(userName?: string | null) {
  if (!userName) {
    return '';
  }
  const clean = userName.trim();
  return clean.length > 0 ? `${clean}, ` : '';
}

function extractQueryFromMessage(message: string) {
  const normalized = normalizeForMatch(message);
  const dropped = normalized
    .replace(/\b(dosya|dosyasi|dosyasini|ac|goster|lutfen|lütfen)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (dropped.length === 0) {
    return '';
  }

  if (dropped.length > 120) {
    return dropped.slice(0, 120);
  }
  return dropped;
}

function tryResolveFileOpenCommand(message: string, userName?: string | null): AssistantActionPlan | null {
  const normalized = normalizeForMatch(message);
  const containsFile = hasNearToken(normalized, ['dosya', 'dosyayi', 'dosyasini', 'belge', 'evrak']);
  const containsOpen = hasNearToken(normalized, ['ac', 'a', 'goster', 'gostr', 'acabilir', 'acarmisin']);
  if (!containsFile || !containsOpen) {
    return null;
  }

  const query = extractQueryFromMessage(message) || 'dosya';
  const encodedQuery = encodeURIComponent(query);
  const addressPrefix = buildAddressPrefix(userName);

  return {
    intent: 'files.open',
    reply: `${addressPrefix}"${query}" için belge merkezini açıyorum ve ilgili sonuçları listeliyorum.`,
    actions: [
      {
        toolName: 'app.navigate',
        params: {
          route: `/editor?q=${encodedQuery}`,
          reason: 'Kullanıcı dosya açma komutu verdi',
        },
      },
      {
        toolName: 'files.search',
        params: {
          query,
        },
      },
    ],
    needsConfirmation: false,
    suggestions: ['Yeni görev oluştur', 'Bugünü özetle', 'Toplantılarımı göster'],
    memoryWrites: [],
  };
}

function normalizeClientName(rawName: string) {
  const cleaned = normalizeForMatch(rawName)
    .replace(/\b(muvekkil|adli|isimli)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return '';
  }

  if (cleaned.endsWith('ye') || cleaned.endsWith('ya')) {
    return cleaned.slice(0, -2).trim();
  }
  if (cleaned.endsWith('e') || cleaned.endsWith('a')) {
    return cleaned.slice(0, -1).trim();
  }
  return cleaned;
}

function tryResolveClientMessageCommand(message: string, userName?: string | null): AssistantActionPlan | null {
  const normalized = normalizeForMatch(message);
  const rawRegex = /m[üu]vekkil\s+(.+?)\s+mesaj\s+(?:at|gönder|gonder|yolla)\s*(.*)$/i;
  const normalizedRegex = /muvekkil\s+(.+?)\s+mesaj\s+(?:at|gonder|yolla)\s*(.*)$/;
  const rawMatch = message.match(rawRegex);
  const normalizedMatch = normalized.match(normalizedRegex);
  const clientPart = rawMatch?.[1] ?? normalizedMatch?.[1] ?? '';
  const bodyPart = rawMatch?.[2] ?? normalizedMatch?.[2] ?? '';

  if (!rawMatch && !normalizedMatch) {
    return null;
  }

  const clientName = normalizeClientName(clientPart);
  const messageBodyRaw = bodyPart.replace(/^["“'`]+|["”'`]+$/g, '').trim();
  const addressPrefix = buildAddressPrefix(userName);

  if (!clientName) {
    return {
      intent: 'clients.message.compose',
      reply: `${addressPrefix}müvekkil ismini net yazar mısın? Örnek: Müvekkil Kerim'e mesaj at "Duruşma saati 14:00".`,
      actions: [],
      needsConfirmation: false,
      suggestions: ['Müvekkil Kerim mesajları aç', 'Müvekkilleri aç', 'Mail sayfasını aç'],
      memoryWrites: [],
    };
  }

  if (!messageBodyRaw) {
    return {
      intent: 'clients.message.compose',
      reply: `${addressPrefix}${clientName} için mesaj metnini de yazmalısın. Örnek: Müvekkil ${clientName} mesaj at "Dosya evrakını bugün paylaşacağım."`,
      actions: [],
      needsConfirmation: false,
      suggestions: ['Müvekkilleri aç', 'Dosya bul', 'Bugünü özetle'],
      memoryWrites: [],
    };
  }

  return {
    intent: 'clients.message.send',
    reply: `${addressPrefix}${clientName} için mesajı hazırladım. Güvenlik için onayından sonra göndereceğim.`,
    actions: [
      {
        toolName: 'clients.message.send',
        params: {
          clientName,
          body: messageBodyRaw,
          sendEmailAlso: hasNearToken(normalized, ['email', 'mail']) || normalized.includes('eposta'),
        },
      },
    ],
    needsConfirmation: true,
    suggestions: ['Müvekkilleri aç', 'Dosya bul', 'Görev ekle'],
    memoryWrites: [],
  };
}

function resolveRouteCommand(normalizedMessage: string, userName?: string | null): AssistantActionPlan | null {
  const match = ROUTE_COMMANDS.find((command) => fuzzyPhraseIncluded(normalizedMessage, command.phrase));
  if (!match) {
    return null;
  }

  const addressPrefix = buildAddressPrefix(userName);

  return {
    intent: 'app.navigate',
    reply: `${addressPrefix}${match.label} sayfasını açıyorum.`,
    actions: [
      {
        toolName: 'app.navigate',
        params: {
          route: match.route,
          reason: `Hızlı komut: ${match.phrase}`,
        },
      },
    ],
    needsConfirmation: false,
    suggestions: ['Bugünü özetle', 'Görevlerimi aç', 'Dosya bul'],
    memoryWrites: [],
  };
}

function buildCommandCatalogReply(userName?: string | null) {
  const addressPrefix = buildAddressPrefix(userName);
  return `${addressPrefix}hazır 50+ komut yüklü. Örnekler: "mail sayfasını aç", "görevlerimi aç", "takvimi aç", "bugünü özetle", "dosya bul kira sözleşmesi", "müvekkil Kerim'e mesaj at \\"Duruşma 14:00\\"".`;
}

function resolveToolCommand(message: string, normalizedMessage: string, userName?: string | null): AssistantActionPlan | null {
  const match = TOOL_COMMANDS.find((command) => fuzzyPhraseIncluded(normalizedMessage, command.phrase));
  if (!match) {
    return null;
  }

  if (match.toolName === 'assistant.help') {
    return {
      intent: 'assistant.help',
      reply: buildCommandCatalogReply(userName),
      actions: [],
      needsConfirmation: false,
      suggestions: ['Mail sayfasını aç', 'Toplantılarımı göster', 'Dosya bul'],
      memoryWrites: [],
    };
  }

  const query = match.requiresQuery ? extractQueryFromMessage(message) || match.queryFallback || 'dosya' : undefined;
  const addressPrefix = buildAddressPrefix(userName);

  return {
    intent: match.toolName,
    reply: `${addressPrefix}${match.label} komutunu çalıştırıyorum.`,
    actions: [
      {
        toolName: match.toolName,
        params: query ? { query } : {},
      },
    ],
    needsConfirmation: match.toolName === 'tasks.create' || match.toolName === 'calendar.extract_tasks',
    suggestions: ['Bugünü özetle', 'Geciken işleri listele', 'Mail sayfasını aç'],
    memoryWrites: [],
  };
}

export function resolveDeterministicAssistantCommand(input: ResolveCommandInput): AssistantActionPlan | null {
  const normalized = normalizeForMatch(input.message);
  if (normalized.length === 0) {
    return null;
  }

  const fileOpen = tryResolveFileOpenCommand(input.message, input.userName);
  if (fileOpen) {
    return fileOpen;
  }

  const clientMessage = tryResolveClientMessageCommand(input.message, input.userName);
  if (clientMessage) {
    return clientMessage;
  }

  const routePlan = resolveRouteCommand(normalized, input.userName);
  if (routePlan) {
    return routePlan;
  }

  return resolveToolCommand(input.message, normalized, input.userName);
}
