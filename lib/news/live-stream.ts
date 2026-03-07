import 'server-only';

import { createHash } from 'node:crypto';
import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveLegalModelWithFallback } from '@/lib/ai/model-provider';
import { serverEnv } from '@/lib/config/env.server';
import type { DashboardCaseLite, DashboardNewsPayload, LiveNewsItem, NewsCategory, NewsSeverity, NewsSourceHealth, WorkspaceTag } from '@/lib/news/types';
import type { DecodeResult as GoogleDecodeResult, GoogleDecoder as GoogleDecoderClient } from 'google-news-url-decoder';

type DomainSourceConfig = {
  id: string;
  name: string;
  domain: string;
  websiteUrl: string;
  searchTerms: string[];
};

type RawFeedItem = {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  title: string;
  link: string;
  publishedAt: string;
  updatedAt?: string;
  summary: string;
  detailText?: string;
  highlights?: string[];
  isWhitelistedSource: boolean;
};

type FetchResult = {
  status: NewsSourceHealth;
  items: RawFeedItem[];
};

type GoogleDecoderModule = {
  GoogleDecoder: new (proxy?: string | null) => GoogleDecoderClient;
};

type NewsSummaryModelSelection = Awaited<ReturnType<typeof resolveLegalModelWithFallback>>;

type StructuredNewsSummary = {
  oneLiner: string;
  bullets: string[];
  whoWhatWhereWhen: {
    who: string;
    what: string;
    where: string;
    when: string;
  };
  numbers: string[];
  uncertainties: string[];
};

type PreparedNewsSnapshot = {
  generatedAt: string;
  sourceHealth: NewsSourceHealth[];
  rawItems: RawFeedItem[];
};

let googleDecoderPromise: Promise<GoogleDecoderClient | null> | null = null;
let newsSummaryModelPromise: Promise<NewsSummaryModelSelection | null> | null = null;
let preparedNewsSnapshotPromise: Promise<PreparedNewsSnapshot> | null = null;
const NEWS_SUMMARY_CACHE = new Map<string, { value: StructuredNewsSummary; expiresAt: number }>();
let preparedNewsSnapshotCache: { value: PreparedNewsSnapshot; expiresAt: number } | null = null;
let lastNonEmptyPreparedNewsSnapshot: PreparedNewsSnapshot | null = null;

const DEFAULT_KEYWORD_FOLLOWUPS = [
  'kira artisi',
  'isten cikarma',
  'kisisel veri ihlali',
  'ticari faiz',
  'teminat mektubu',
] as const;

const GOOGLE_NEWS_SOURCES: DomainSourceConfig[] = [
  { id: 'resmi-gazete', name: 'Resmi Gazete', domain: 'resmigazete.gov.tr', websiteUrl: 'https://www.resmigazete.gov.tr', searchTerms: ['kanun', 'yonetmelik', 'teblig'] },
  { id: 'tbmm', name: 'TBMM', domain: 'tbmm.gov.tr', websiteUrl: 'https://www.tbmm.gov.tr', searchTerms: ['kanun', 'komisyon', 'genel kurul'] },
  { id: 'adalet', name: 'Adalet Bakanligi', domain: 'adalet.gov.tr', websiteUrl: 'https://www.adalet.gov.tr', searchTerms: ['duyuru', 'genelge', 'yargi'] },
  { id: 'yargitay', name: 'Yargitay', domain: 'yargitay.gov.tr', websiteUrl: 'https://www.yargitay.gov.tr', searchTerms: ['karar', 'ictihat', 'duyuru'] },
  { id: 'danistay', name: 'Danistay', domain: 'danistay.gov.tr', websiteUrl: 'https://www.danistay.gov.tr', searchTerms: ['karar', 'ictihat', 'duyuru'] },
  { id: 'aym', name: 'Anayasa Mahkemesi', domain: 'anayasa.gov.tr', websiteUrl: 'https://www.anayasa.gov.tr', searchTerms: ['karar', 'bireysel basvuru', 'duyuru'] },
  { id: 'kvkk', name: 'KVKK', domain: 'kvkk.gov.tr', websiteUrl: 'https://www.kvkk.gov.tr', searchTerms: ['rehber', 'ihlal', 'duyuru'] },
  { id: 'rekabet', name: 'Rekabet Kurumu', domain: 'rekabet.gov.tr', websiteUrl: 'https://www.rekabet.gov.tr', searchTerms: ['karar', 'duyuru', 'teblig'] },
  { id: 'spk', name: 'SPK', domain: 'spk.gov.tr', websiteUrl: 'https://www.spk.gov.tr', searchTerms: ['duzenleme', 'teblig', 'duyuru'] },
  { id: 'bddk', name: 'BDDK', domain: 'bddk.org.tr', websiteUrl: 'https://www.bddk.org.tr', searchTerms: ['duzenleme', 'genelge', 'duyuru'] },
  { id: 'epdk', name: 'EPDK', domain: 'epdk.gov.tr', websiteUrl: 'https://www.epdk.gov.tr', searchTerms: ['enerji', 'duzenleme', 'duyuru'] },
  { id: 'btk', name: 'BTK', domain: 'btk.gov.tr', websiteUrl: 'https://www.btk.gov.tr', searchTerms: ['elektronik haberlesme', 'duzenleme', 'duyuru'] },
  { id: 'tcmb', name: 'TCMB', domain: 'tcmb.gov.tr', websiteUrl: 'https://www.tcmb.gov.tr', searchTerms: ['duzenleme', 'karar', 'finans'] },
  { id: 'ticaret', name: 'Ticaret Bakanligi', domain: 'ticaret.gov.tr', websiteUrl: 'https://www.ticaret.gov.tr', searchTerms: ['eticaret', 'duzenleme', 'duyuru'] },
  { id: 'gib', name: 'Gelir Idaresi Baskanligi', domain: 'gib.gov.tr', websiteUrl: 'https://www.gib.gov.tr', searchTerms: ['teblig', 'vergi', 'duyuru'] },
  { id: 'sgk', name: 'SGK', domain: 'sgk.gov.tr', websiteUrl: 'https://www.sgk.gov.tr', searchTerms: ['genelge', 'duyuru', 'sigorta'] },
  { id: 'barobirlik', name: 'Turkiye Barolar Birligi', domain: 'barobirlik.org.tr', websiteUrl: 'https://www.barobirlik.org.tr', searchTerms: ['duyuru', 'meslek', 'hukuk'] },
  { id: 'kik', name: 'Kamu Ihale Kurumu', domain: 'kik.gov.tr', websiteUrl: 'https://www.kik.gov.tr', searchTerms: ['ihale', 'teblig', 'duyuru'] },
  { id: 'sayistay', name: 'Sayistay', domain: 'sayistay.gov.tr', websiteUrl: 'https://www.sayistay.gov.tr', searchTerms: ['karar', 'rapor', 'duyuru'] },
  { id: 'enerji-bakanligi', name: 'Enerji Bakanligi', domain: 'enerji.gov.tr', websiteUrl: 'https://www.enerji.gov.tr', searchTerms: ['enerji', 'duzenleme', 'duyuru'] },
];
const DEFAULT_TRUSTED_X_ACCOUNTS = 'ResmiGazete,TBMMresmi,adalet_bakanlik,KVKKKurumu,YargitayBaskanlik';
const TRUSTED_OFFICIAL_SOURCE_IDS = new Set(GOOGLE_NEWS_SOURCES.map((source) => source.id));
const TRUSTED_OFFICIAL_SOURCE_DOMAINS = [...new Set(GOOGLE_NEWS_SOURCES.map((source) => source.domain.toLowerCase()))];
const TRUSTED_X_ACCOUNTS = new Set(
  (process.env.NEWS_X_ACCOUNTS ?? DEFAULT_TRUSTED_X_ACCOUNTS)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0),
);

const WORKSPACE_RULES: Array<{ workspace: WorkspaceTag; keywords: string[] }> = [
  { workspace: 'icra', keywords: ['icra', 'haciz', 'takip', 'tebligat', 'iflas'] },
  { workspace: 'is', keywords: ['is hukuku', 'isci', 'isveren', 'kidem', 'fesih', 'ise iade'] },
  { workspace: 'kira', keywords: ['kira', 'kiraci', 'tahliye', 'tufe'] },
  { workspace: 'ceza', keywords: ['ceza', 'sorusturma', 'kovusturma', 'suclama'] },
  { workspace: 'kvkk', keywords: ['kvkk', 'kisisel veri', 'veri ihlali', 'acik riza'] },
  { workspace: 'finans', keywords: ['finans', 'banka', 'kredi', 'tcmb', 'spk', 'bddk', 'teminat'] },
  { workspace: 'eticaret', keywords: ['eticaret', 'e-ticaret', 'mesafeli satis', 'pazaryeri'] },
  { workspace: 'enerji', keywords: ['enerji', 'epdk', 'elektrik', 'dogalgaz'] },
];

const CATEGORY_RULES: Array<{ category: NewsCategory; keywords: string[] }> = [
  { category: 'Ictihat', keywords: ['yargitay', 'danistay', 'anayasa mahkemesi', 'ictihat', 'emsal karar', 'karar ozeti'] },
  { category: 'Mevzuat', keywords: ['kanun', 'yonetmelik', 'teblig', 'resmi gazete', 'yururluge', 'degisiklik'] },
  { category: 'Duyuru', keywords: ['duyuru', 'bakim', 'ilan', 'aciklama', 'takvim'] },
];

const CRITICAL_SEVERITY_KEYWORDS = ['yururluk', 'zorunlu', 'ceza', 'iptal', 'son tarih', 'idari para cezasi'];
const MEDIUM_SEVERITY_KEYWORDS = ['guncelleme', 'duzenleme', 'rehber', 'karar', 'taslak'];
const STOP_WORDS = new Set(['ve', 'ile', 'icin', 'olan', 'gibi', 'hakkinda', 'karar', 'duyuru', 'kanun', 'yonetmelik']);
const TRACKING_PARAM_PREFIXES = ['utm_', 'fbclid', 'gclid', 'igshid', 'ref', 'oc', 'ved'];
const GOOGLE_NEWS_DECODE_LIMIT = 12;
const GOOGLE_NEWS_DECODE_CONCURRENCY = 6;
const GOOGLE_NEWS_RECENCY_FILTER = 'when:30d';
const NEWS_ENRICH_LIMIT = 20;
const NEWS_ENRICH_CONCURRENCY = 8;
const NEWS_SUMMARY_BUDGET_PER_RUN = 0;
const NEWS_SUMMARY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NEWS_SUMMARY_CACHE_LIMIT = 600;
const NEWS_ARTICLE_FETCH_TIMEOUT_MS = 1500;
const NEWS_SOURCE_FETCH_TIMEOUT_MS = 5500;
const NEWS_SOURCE_ITEMS_PER_FEED = 6;
const NEWS_X_FALLBACK_ITEMS_PER_FEED = 6;
const NEWS_CANDIDATE_POOL_LIMIT = 70;
const DASHBOARD_NEWS_SNAPSHOT_TTL_MS = 2 * 60 * 1000;
const EMPTY_SNAPSHOT_TTL_MS = 15 * 1000;
const NEWS_CHUNK_TARGET_WORDS = 950;
const NEWS_CHUNK_MAX_WORDS = 1300;
const NEWS_CHUNK_MIN_WORDS = 250;
const NEWS_MAX_CHUNKS = 6;
const LOW_QUALITY_SNIPPETS = [
  'comprehensive up-to-date news coverage',
  'aggregated from sources all over the world by google news',
  'full coverage on google news',
  'google news',
  'read full article',
  'ayrintilar icin kaynak baglantisini acin',
  'bu kayit otomatik haber akisindan alinmistir',
  'resmi ayrintilar icin kaynak metnini dogrudan inceleyin',
  'kaynaginda yeni bir guncelleme yayimlandi',
  'baslikli duyuru yayimlandi',
  'kaynaginda "',
  'kaynak metni ac ve degisikligin kapsamini dogrula',
  'etkilenen dosyalarda gorev acip sorumlu kisiye ata',
  'emsal karari ilgili dilekce/ictihat notuna bagla',
] as const;
const LEGAL_RELEVANCE_KEYWORDS = [
  'kanun',
  'yonetmelik',
  'teblig',
  'genelge',
  'karar',
  'ictihat',
  'mahkeme',
  'yargi',
  'duyuru',
  'resmi gazete',
  'tbmm',
  'kvkk',
  'kurul',
  'idari para cezasi',
  'yururluk',
  'taslak',
] as const;
const LOW_LEGAL_RELEVANCE_KEYWORDS = [
  'futbol',
  'transfer',
  'maglup',
  'galibiyet',
  'savas',
  'hava saldirisi',
  'diplomasi',
  'parti',
  'secim mitingi',
  'yarisma sonuclari',
] as const;
const LEGAL_RELEVANCE_MIN_SCORE = 2.4;

const chunkSummarySchema = z.object({
  one_liner: z.string().min(1).max(320),
  bullets: z.array(z.string().min(1).max(240)).min(1).max(5),
  numbers: z.array(z.string().min(1).max(120)).max(10),
  uncertainties: z.array(z.string().min(1).max(220)).max(6),
});

const publishableSummarySchema = z.object({
  publishable: z.boolean(),
  summary: z.string().max(3200),
});

function normalize(input: string) {
  return input.toLocaleLowerCase('tr-TR');
}

function hasSummaryModelConfig() {
  return Boolean(
    serverEnv.GOOGLE_GENERATIVE_AI_API_KEY ||
      serverEnv.COHERE_API_KEY ||
      serverEnv.OPENAI_API_KEY,
  );
}

async function getNewsSummaryModel() {
  if (!hasSummaryModelConfig()) {
    return null;
  }
  if (newsSummaryModelPromise) {
    return newsSummaryModelPromise;
  }

  newsSummaryModelPromise = resolveLegalModelWithFallback('summary').catch(() => null);
  return newsSummaryModelPromise;
}

function pruneSummaryCache(now = Date.now()) {
  for (const [cacheKey, entry] of NEWS_SUMMARY_CACHE.entries()) {
    if (entry.expiresAt <= now) {
      NEWS_SUMMARY_CACHE.delete(cacheKey);
    }
  }

  if (NEWS_SUMMARY_CACHE.size <= NEWS_SUMMARY_CACHE_LIMIT) {
    return;
  }

  const sorted = [...NEWS_SUMMARY_CACHE.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const deleteCount = NEWS_SUMMARY_CACHE.size - NEWS_SUMMARY_CACHE_LIMIT;
  for (let i = 0; i < deleteCount; i += 1) {
    NEWS_SUMMARY_CACHE.delete(sorted[i][0]);
  }
}

function getCachedSummary(cacheKey: string) {
  const cached = NEWS_SUMMARY_CACHE.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    NEWS_SUMMARY_CACHE.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function setCachedSummary(cacheKey: string, value: StructuredNewsSummary) {
  pruneSummaryCache();
  NEWS_SUMMARY_CACHE.set(cacheKey, {
    value,
    expiresAt: Date.now() + NEWS_SUMMARY_CACHE_TTL_MS,
  });
}

function consumeSummaryBudget(budget: { remaining: number }) {
  if (budget.remaining <= 0) {
    return false;
  }
  budget.remaining -= 1;
  return true;
}

function decodeXmlEntities(input: string) {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const value = Number.parseInt(hex, 16);
      return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : _;
    })
    .replace(/&#([0-9]+);/g, (_, num) => {
      const value = Number.parseInt(num, 10);
      return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : _;
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&ccedil;/g, 'ç')
    .replace(/&Ccedil;/g, 'Ç')
    .replace(/&ouml;/g, 'ö')
    .replace(/&Ouml;/g, 'Ö')
    .replace(/&uuml;/g, 'ü')
    .replace(/&Uuml;/g, 'Ü')
    .replace(/&scedil;/g, 'ş')
    .replace(/&Scedil;/g, 'Ş')
    .replace(/&iacute;/g, 'í')
    .replace(/&Iacute;/g, 'Í')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function stripHtml(input: string) {
  return decodeXmlEntities(input).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function readSingleTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXmlEntities(match[1]).trim() : '';
}

function readAtomLink(block: string) {
  const hrefMatch = block.match(/<link\b[^>]*href="([^"]+)"[^>]*\/?>/i);
  return hrefMatch ? decodeXmlEntities(hrefMatch[1]).trim() : '';
}

function toIsoDate(dateText: string) {
  const parsed = Date.parse(dateText);
  if (Number.isNaN(parsed)) {
    return new Date().toISOString();
  }
  return new Date(parsed).toISOString();
}

function trimSummary(summary: string) {
  if (summary.length <= 280) {
    return summary;
  }
  return `${summary.slice(0, 277)}...`;
}

function canonicalizeUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    [...parsed.searchParams.keys()].forEach((key) => {
      if (TRACKING_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        parsed.searchParams.delete(key);
      }
    });
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function isHttpUrl(urlText: string) {
  try {
    const parsed = new URL(urlText);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function extractHostname(urlText: string) {
  try {
    return new URL(urlText).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isHostWithinDomain(hostname: string, domain: string) {
  const normalizedHost = hostname.toLowerCase().replace(/^www\./, '');
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function extractXUsername(urlText: string, sourceName = '') {
  const sourceMatch = sourceName.match(/@([A-Za-z0-9_]{2,30})/);
  if (sourceMatch?.[1]) {
    return sourceMatch[1].toLowerCase();
  }

  try {
    const parsed = new URL(urlText);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname !== 'x.com' && hostname !== 'twitter.com') {
      return '';
    }
    const firstPathSegment = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
    return firstPathSegment.replace(/^@/, '').toLowerCase();
  } catch {
    return '';
  }
}

function isTrustedSource(item: Pick<RawFeedItem, 'sourceId' | 'sourceName' | 'sourceUrl' | 'link'>) {
  if (TRUSTED_OFFICIAL_SOURCE_IDS.has(item.sourceId)) {
    return true;
  }

  const linkHost = extractHostname(item.link);
  const sourceHost = extractHostname(item.sourceUrl);
  const fromTrustedDomain = TRUSTED_OFFICIAL_SOURCE_DOMAINS.some((domain) => {
    return isHostWithinDomain(linkHost, domain) || isHostWithinDomain(sourceHost, domain);
  });
  if (fromTrustedDomain) {
    return true;
  }

  if (item.sourceId === 'x-twitter') {
    const username = extractXUsername(item.link || item.sourceUrl, item.sourceName);
    return username.length > 0 && TRUSTED_X_ACCOUNTS.has(username);
  }

  return false;
}

async function getGoogleDecoder() {
  if (googleDecoderPromise) {
    return googleDecoderPromise;
  }

  googleDecoderPromise = import('google-news-url-decoder')
    .then((module) => {
      const typedModule = module as unknown as GoogleDecoderModule;
      if (!typedModule.GoogleDecoder) {
        return null;
      }
      return new typedModule.GoogleDecoder();
    })
    .catch(() => null);

  return googleDecoderPromise;
}

async function resolveGoogleNewsLinks(items: RawFeedItem[]) {
  const recentSortedLinks = [...items]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .map((item) => item.link)
    .filter((link) => isGoogleNewsUrl(link));
  const candidates = [...new Set(recentSortedLinks)].slice(0, GOOGLE_NEWS_DECODE_LIMIT);
  if (candidates.length === 0) {
    return items;
  }

  const decoder = await getGoogleDecoder();
  if (!decoder) {
    return items;
  }

  let decodeResults: GoogleDecodeResult[] = [];
  try {
    decodeResults = await decoder.decodeBatch(candidates);
  } catch {
    decodeResults = [];
  }

  const decodedMap = new Map<string, string>();
  for (const result of decodeResults) {
    const sourceUrl = result.source_url?.trim();
    const decodedUrl = result.decoded_url?.trim();
    if (!result.status || !sourceUrl || !decodedUrl || !isHttpUrl(decodedUrl) || isGoogleNewsUrl(decodedUrl)) {
      continue;
    }
    decodedMap.set(sourceUrl, canonicalizeUrl(decodedUrl));
  }

  const unresolvedLinks = candidates.filter((url) => !decodedMap.has(url));
  if (unresolvedLinks.length > 0) {
    for (let index = 0; index < unresolvedLinks.length; index += GOOGLE_NEWS_DECODE_CONCURRENCY) {
      const batch = unresolvedLinks.slice(index, index + GOOGLE_NEWS_DECODE_CONCURRENCY);
      const decodedBatch = await Promise.all(
        batch.map(async (googleUrl) => {
          try {
            const result = await decoder.decode(googleUrl);
            const decodedUrl = result.decoded_url?.trim();
            if (!result.status || !decodedUrl || !isHttpUrl(decodedUrl) || isGoogleNewsUrl(decodedUrl)) {
              return null;
            }
            return { sourceUrl: googleUrl, decodedUrl: canonicalizeUrl(decodedUrl) };
          } catch {
            return null;
          }
        }),
      );

      for (const entry of decodedBatch) {
        if (!entry) {
          continue;
        }
        decodedMap.set(entry.sourceUrl, entry.decodedUrl);
      }
    }
  }

  return items.map((item) => {
    const decodedLink = decodedMap.get(item.link);
    if (!decodedLink) {
      return item;
    }
    const updated = {
      ...item,
      link: decodedLink,
      sourceUrl: decodedLink,
    };
    return {
      ...updated,
      isWhitelistedSource: isTrustedSource(updated),
    };
  });
}

function buildItemId(parts: string[]) {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20);
}

function extractFirstHref(htmlOrText: string) {
  const anchorMatch = htmlOrText.match(/href="([^"]+)"/i);
  if (anchorMatch?.[1]) {
    return decodeXmlEntities(anchorMatch[1]);
  }
  const urlMatch = htmlOrText.match(/https?:\/\/[^\s<>"']+/i);
  if (urlMatch?.[0]) {
    return decodeXmlEntities(urlMatch[0]);
  }
  return '';
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}

function parseRssOrAtom(xmlText: string, fallbackSourceName: string, fallbackSourceUrl: string, sourceId: string): RawFeedItem[] {
  const rssItemBlocks = xmlText.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  if (rssItemBlocks.length > 0) {
    return rssItemBlocks
      .map((block) => {
        const title = stripHtml(readSingleTag(block, 'title'));
        const link = decodeXmlEntities(readSingleTag(block, 'link'));
        const descriptionRaw = readSingleTag(block, 'description');
        const contentEncodedRaw = readSingleTag(block, 'content:encoded');
        const publishedAt = toIsoDate(readSingleTag(block, 'pubDate') || readSingleTag(block, 'dc:date'));
        const sourceTagRaw = readSingleTag(block, 'source');
        const sourceTagName = stripHtml(sourceTagRaw);
        const sourceTagUrlMatch = block.match(/<source\b[^>]*url="([^"]+)"/i);
        const sourceUrl = sourceTagUrlMatch?.[1] ? decodeXmlEntities(sourceTagUrlMatch[1]) : fallbackSourceUrl;
        const summary = trimSummary(normalizeWhitespace(stripHtml(descriptionRaw || contentEncodedRaw || title)));
        const detailText = normalizeWhitespace(stripHtml(contentEncodedRaw || descriptionRaw || summary));
        const highlights = buildHighlights(title, summary, detailText);
        const extractedHref = extractFirstHref(descriptionRaw);
        const bestLink = extractedHref || link || fallbackSourceUrl;

        if (!title || !bestLink) {
          return null;
        }

        const canonicalLink = canonicalizeUrl(bestLink);
        const canonicalSourceUrl = canonicalizeUrl(sourceUrl);
        const item: RawFeedItem = {
          sourceId,
          sourceName: sourceTagName || fallbackSourceName,
          sourceUrl: canonicalSourceUrl,
          title,
          link: canonicalLink,
          publishedAt,
          summary,
          detailText,
          highlights,
          isWhitelistedSource: isTrustedSource({
            sourceId,
            sourceName: sourceTagName || fallbackSourceName,
            sourceUrl: canonicalSourceUrl,
            link: canonicalLink,
          }),
        };
        return item;
      })
      .filter(notNull);
  }

  const atomEntryBlocks = xmlText.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return atomEntryBlocks
    .map((block) => {
      const title = stripHtml(readSingleTag(block, 'title'));
      const contentRaw = readSingleTag(block, 'content');
      const summaryRaw = readSingleTag(block, 'summary');
      const summary = trimSummary(normalizeWhitespace(stripHtml(summaryRaw || contentRaw || title)));
      const detailText = normalizeWhitespace(stripHtml(contentRaw || summaryRaw || summary));
      const highlights = buildHighlights(title, summary, detailText);
      const link = readAtomLink(block) || fallbackSourceUrl;
      const publishedAt = toIsoDate(readSingleTag(block, 'updated') || readSingleTag(block, 'published'));

      if (!title || !link) {
        return null;
      }

      const canonicalLink = canonicalizeUrl(link);
      const canonicalSourceUrl = canonicalizeUrl(fallbackSourceUrl);
      const item: RawFeedItem = {
        sourceId,
        sourceName: fallbackSourceName,
        sourceUrl: canonicalSourceUrl,
        title,
        link: canonicalLink,
        publishedAt,
        summary,
        detailText,
        highlights,
        isWhitelistedSource: isTrustedSource({
          sourceId,
          sourceName: fallbackSourceName,
          sourceUrl: canonicalSourceUrl,
          link: canonicalLink,
        }),
      };
      return item;
    })
    .filter(notNull);
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function compactForCompare(text: string) {
  return normalize(text)
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/û/g, 'u')
    .replace(/[^a-z0-9]+/gi, '');
}

function hasLowQualitySnippet(text: string) {
  const normalized = normalize(text);
  return LOW_QUALITY_SNIPPETS.some((snippet) => normalized.includes(snippet));
}

function isGoogleNewsUrl(urlText: string) {
  try {
    const hostname = new URL(urlText).hostname.toLowerCase();
    return hostname === 'news.google.com' || hostname.endsWith('.news.google.com');
  } catch {
    return false;
  }
}

function isGenericTitle(title: string, sourceName: string) {
  const cleanedTitle = normalizeWhitespace(stripHtml(title));
  const normalizedTitle = normalize(cleanedTitle);
  const normalizedSource = normalize(sourceName);
  const titleNoSource = normalizeWhitespace(cleanedTitle.replace(new RegExp(`\\s*-\\s*${sourceName}$`, 'i'), ''));
  const normalizedTitleNoSource = normalize(titleNoSource);
  const titleCompact = compactForCompare(cleanedTitle);
  const sourceCompact = compactForCompare(sourceName);
  const titleNoSourceCompact = compactForCompare(titleNoSource);

  const genericPatterns = [
    'duyurular',
    'duyuru',
    'haberler',
    'announcements',
    'news',
    'guncellemeler',
    'iletisim',
    'misyonumuz',
    'vizyonumuz',
    'hakkimizda',
    'sss',
    'sikca sorulan sorular',
    'genel duyurular',
    'basin',
    'kurul kararlari',
    'daire baskanlari',
    'dergi haberleri',
    'untitled',
    'cumhuriyet bassavcisi',
    'birinci baskani',
  ];
  const genericPatternCompacts = genericPatterns.map((pattern) => compactForCompare(pattern)).filter(Boolean);

  if (/^\d{3,}\.pdf$/i.test(cleanedTitle)) {
    return true;
  }
  if (/^[-–—]\s*[a-z0-9.-]+\.[a-z]{2,}$/i.test(titleNoSource)) {
    return true;
  }
  if (cleanedTitle.includes('?') && !hasStrongNewsSignal(cleanedTitle)) {
    return true;
  }

  if (normalizedTitle === normalizedSource || (titleCompact && sourceCompact && titleCompact === sourceCompact)) {
    return true;
  }

  if (cleanedTitle.length <= 30 && genericPatternCompacts.some((pattern) => titleCompact.includes(pattern))) {
    return true;
  }

  if (genericPatternCompacts.some((pattern) => titleCompact === `${pattern}${sourceCompact}`)) {
    return true;
  }

  if (!hasStrongNewsSignal(cleanedTitle) && genericPatternCompacts.some((pattern) => titleNoSourceCompact.includes(pattern))) {
    return true;
  }

  return false;
}

function hasConcreteContext(text: string) {
  const normalizedText = normalize(text);
  const compactText = compactForCompare(text);
  if (!normalizedText || !compactText) {
    return false;
  }

  if (compactText.includes('tarih') || compactText.includes('birim') || compactText.includes('ekdosya')) {
    return true;
  }

  if (/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(text)) {
    return true;
  }

  const monthHints = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];
  return monthHints.some((hint) => compactText.includes(hint));
}

function hasStrongNewsSignal(text: string) {
  const compactText = compactForCompare(text);
  if (!compactText) {
    return false;
  }

  const newsSignals = [
    'kanun',
    'yonetmelik',
    'teblig',
    'karar',
    'duyuru',
    'ihlal',
    'genelge',
    'duzenleme',
    'resmi gazete',
    'yururluk',
    'cezasi',
    'bulten',
    'teklif',
  ];
  if (newsSignals.some((signal) => compactText.includes(signal))) {
    return true;
  }
  if (/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(text)) {
    return true;
  }
  if (/\b20\d{2}\/\d{1,4}\b/.test(text)) {
    return true;
  }

  return false;
}

function sanitizeBoilerplateText(text: string) {
  const stripped = normalizeWhitespace(
    text
      .replace(/Ayrintilar icin kaynak baglantisini acin\.?/gi, ' ')
      .replace(/Bu kayit otomatik haber akisindan alinmistir;?/gi, ' ')
      .replace(/resmi ayrintilar icin kaynak metnini dogrudan inceleyin\.?/gi, ' ')
      .replace(/kaynaginda\s+"[^"]+"\s+baslikli yeni bir guncelleme yayinlandi\.?/gi, ' ')
      .replace(/kaynaginda\s+"[^"]+"\s+baslikli duyuru yayimlandi\.?/gi, ' ')
      .replace(/kaynaginda\s+yeni bir guncelleme yayinlandi\.?/gi, ' ')
      .replace(/kaynaginda\s+yeni bir guncelleme yayimlandi\.?/gi, ' ')
      .replace(/Kaynak metni ac ve degisikligin kapsamini dogrula\.?/gi, ' ')
      .replace(/Etkilenen dosyalarda gorev acip sorumlu kisiye ata\.?/gi, ' ')
      .replace(/Emsal karari ilgili dilekce\/ictihat notuna bagla\.?/gi, ' '),
  );

  return collapseRepeatedPrefixChunks(collapseRepeatedPrefixChunks(stripped));
}

function collapseRepeatedPrefixChunks(text: string) {
  const normalizedText = normalizeWhitespace(text);
  const words = normalizedText.split(/\s+/).filter(Boolean);
  if (words.length < 12) {
    return normalizedText;
  }

  const maxChunkSize = Math.min(18, Math.floor(words.length / 2));
  for (let chunkSize = maxChunkSize; chunkSize >= 6; chunkSize -= 1) {
    const firstChunk = words.slice(0, chunkSize).join(' ');
    const firstCompact = compactForCompare(firstChunk);
    if (!firstCompact) {
      continue;
    }

    let index = chunkSize;
    let repeated = false;
    while (index + chunkSize <= words.length) {
      const nextChunk = words.slice(index, index + chunkSize).join(' ');
      if (compactForCompare(nextChunk) !== firstCompact) {
        break;
      }
      repeated = true;
      index += chunkSize;
    }

    if (repeated) {
      return normalizeWhitespace([...words.slice(0, chunkSize), ...words.slice(index)].join(' '));
    }
  }

  return normalizedText;
}

function normalizeTitleForSummary(title: string, sourceName: string) {
  const cleaned = sanitizeBoilerplateText(stripHtml(title));
  if (!cleaned) {
    return '';
  }

  const parts = cleaned
    .split(/\s+-\s+/)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length > 0);

  if (parts.length <= 1) {
    return cleaned;
  }

  const sourceCompact = compactForCompare(sourceName);
  const uniqueParts = parts.filter((part, index) => {
    const compact = compactForCompare(part);
    if (!compact) {
      return false;
    }
    if (sourceCompact && compact === sourceCompact) {
      return false;
    }
    return !parts.slice(0, index).some((prev) => compactForCompare(prev) === compact);
  });

  if (uniqueParts.length > 0) {
    return uniqueParts.join(' - ');
  }

  return parts[0] ?? cleaned;
}

function isTextEchoingTitle(text: string, title: string) {
  const normalizedText = sanitizeBoilerplateText(text);
  const normalizedTitle = normalizeTitleForSummary(title, '');
  const textCompact = compactForCompare(normalizedText);
  const titleCompact = compactForCompare(normalizedTitle);

  if (!textCompact || !titleCompact) {
    return false;
  }

  if (textCompact === titleCompact) {
    return true;
  }

  if (textCompact.includes(titleCompact) && textCompact.replace(titleCompact, '').length < 28) {
    return true;
  }

  return false;
}

function isInformativeSummary(summary: string, title: string, sourceName: string) {
  if (summary.length < 45) {
    return false;
  }

  const summaryCompact = compactForCompare(summary);
  const titleCompact = compactForCompare(title);
  const sourceCompact = compactForCompare(sourceName);

  if (!summaryCompact) {
    return false;
  }
  if (titleCompact && summaryCompact === titleCompact) {
    return false;
  }
  if (sourceCompact && summaryCompact === sourceCompact) {
    return false;
  }
  if (titleCompact && summaryCompact.includes(titleCompact) && summaryCompact.length <= titleCompact.length + 24) {
    return false;
  }

  return true;
}

function buildFallbackSummary(title: string, sourceName: string, contextText = '') {
  const normalizedContext = sanitizeBoilerplateText(contextText);
  const contextSentences = splitIntoCandidateSentences(normalizedContext);
  const titleCandidate = normalizeTitleForSummary(title, sourceName);
  const titleCompact = compactForCompare(titleCandidate);
  const contextCandidate = contextSentences.find((sentence) => {
    const compact = compactForCompare(sentence);
    if (!compact) {
      return false;
    }
    if (titleCompact && compact === titleCompact) {
      return false;
    }
    if (isTextEchoingTitle(sentence, title)) {
      return false;
    }
    return !hasLowQualitySnippet(sentence);
  });

  if (contextCandidate) {
    return trimSummary(contextCandidate);
  }

  if (titleCandidate) {
    const withPunctuation = /[.!?]$/.test(titleCandidate) ? titleCandidate : `${titleCandidate}.`;
    return trimSummary(withPunctuation);
  }

  return 'Haber metninde ozet cikarmaya yetecek acik ayrinti bulunmuyor.';
}

function isFallbackSummary(summary: string) {
  const normalized = normalize(summary);
  return normalized.includes('ozet cikarmaya yetecek acik ayrinti bulunmuyor');
}

function normalizeSummary(summary: string, title: string, sourceName: string, fallbackContext = '') {
  const cleaned = sanitizeBoilerplateText(summary);
  if (!cleaned || hasLowQualitySnippet(cleaned) || !isInformativeSummary(cleaned, title, sourceName)) {
    return buildFallbackSummary(title, sourceName, fallbackContext);
  }
  return cleaned;
}

function isInformativeDetail(detailText: string, summary: string, title: string) {
  if (detailText.length < 60) {
    return false;
  }

  const detailCompact = compactForCompare(detailText);
  if (!detailCompact) {
    return false;
  }
  if (hasLowQualitySnippet(detailText)) {
    return false;
  }
  if (detailCompact === compactForCompare(summary)) {
    return false;
  }
  if (detailCompact === compactForCompare(title)) {
    return false;
  }

  return true;
}

function buildFallbackDetail(summary: string, title: string, contextText = '') {
  const normalizedContext = sanitizeBoilerplateText(contextText);
  const candidateText = normalizeWhitespace(`${normalizedContext} ${summary} ${title}`);
  const sentences = splitIntoCandidateSentences(candidateText).filter((sentence) => !isTextEchoingTitle(sentence, title));
  const uniqueSentences: string[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    const compact = compactForCompare(sentence);
    if (!compact || seen.has(compact)) {
      continue;
    }
    seen.add(compact);
    uniqueSentences.push(sentence);
  }

  if (uniqueSentences.length > 0) {
    return normalizeWhitespace(uniqueSentences.slice(0, 4).join(' '));
  }

  if (summary) {
    return summary;
  }

  const normalizedTitle = normalizeTitleForSummary(title, '');
  if (normalizedTitle) {
    return normalizedTitle;
  }

  return 'Haber metninde ozet cikarmaya yetecek acik ayrinti bulunmuyor.';
}

function isFallbackDetail(detailText: string) {
  return normalize(detailText).includes('ozet cikarmaya yetecek acik ayrinti bulunmuyor');
}

function normalizeDetail(detailText: string, summary: string, title: string) {
  const cleaned = sanitizeBoilerplateText(detailText);
  if (!isInformativeDetail(cleaned, summary, title)) {
    return buildFallbackDetail(summary, title, cleaned);
  }
  return cleaned;
}

function extractMetaDescription(html: string) {
  const metaPatterns = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
  ];

  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const cleaned = normalizeWhitespace(stripHtml(match[1]));
      if (cleaned.length >= 60) {
        return cleaned;
      }
    }
  }

  return '';
}

function extractTagContent(html: string, tagName: 'article' | 'main') {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match?.[1] ?? '';
}

function stripNonContentHtml(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, ' ');
}

function looksNoisyParagraph(paragraph: string) {
  const normalized = normalize(paragraph);
  if (paragraph.length < 45 || paragraph.length > 1800) {
    return true;
  }
  const wordCount = paragraph.split(/\s+/).filter(Boolean).length;
  if (wordCount < 8) {
    return true;
  }
  if (/^[A-Z0-9\s\-|/:.;,()]+$/.test(paragraph)) {
    return true;
  }

  const noisyHints = [
    'anasayfa',
    'menu',
    'iletisim',
    'gizlilik',
    'cerez',
    'cookie',
    'devamini oku',
    'abonelik',
    'abone ol',
    'tumunu gor',
    'related',
    'yorum yap',
    'tum haklari saklidir',
    'kvkk',
    'javascript',
    'telefon',
    'tel:',
    'faks',
    'fax',
    'e-posta',
    'eposta',
    'adres',
    'mahallesi',
    'bulvari',
    'cadde',
  ];

  if (noisyHints.some((hint) => normalized.includes(hint))) {
    return true;
  }

  const urlCount = (paragraph.match(/https?:\/\//gi) ?? []).length;
  if (urlCount >= 2 && wordCount < 30) {
    return true;
  }

  const fileRefCount = (paragraph.match(/\.(?:pdf|docx?|xlsx?|pptx?|zip|rar)\b/gi) ?? []).length;
  if (fileRefCount >= 2 && wordCount < 80) {
    return true;
  }

  return false;
}

function extractParagraphCandidates(html: string) {
  const sanitized = stripNonContentHtml(html);
  return [...sanitized.matchAll(/<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/gi)]
    .map((match) => normalizeWhitespace(stripHtml(match[1] ?? '')))
    .filter((paragraph) => !looksNoisyParagraph(paragraph));
}

function extractContentDivCandidates(html: string) {
  const patterns = [
    /<div\b[^>]*class="[^"]*\bspeak-area\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div\b[^>]*class="[^"]*\b(?:entry-content|article-content|post-content|news-content|content-body|announcement-detail)\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<section\b[^>]*class="[^"]*\b(?:entry-content|article-content|post-content|news-content|content-body)\b[^"]*"[^>]*>([\s\S]*?)<\/section>/gi,
  ];

  const candidates: string[] = [];
  for (const pattern of patterns) {
    const matches = [...html.matchAll(pattern)];
    for (const match of matches) {
      const raw = match[1] ?? '';
      const cleaned = normalizeWhitespace(stripHtml(raw));
      if (!looksNoisyParagraph(cleaned)) {
        candidates.push(cleaned);
      }
    }
  }

  return candidates;
}

function dedupeParagraphs(paragraphs: string[]) {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const paragraph of paragraphs) {
    const compact = compactForCompare(paragraph);
    if (!compact || seen.has(compact)) {
      continue;
    }
    seen.add(compact);
    unique.push(paragraph);
  }
  return unique;
}

function extractMainArticleText(html: string) {
  const sanitizedHtml = stripNonContentHtml(html);
  const articleBlock = extractTagContent(sanitizedHtml, 'article');
  const mainBlock = extractTagContent(sanitizedHtml, 'main');
  const contentBlocks = [
    ...extractContentDivCandidates(articleBlock),
    ...extractContentDivCandidates(mainBlock),
    ...extractContentDivCandidates(sanitizedHtml),
  ];

  const primaryParagraphs = dedupeParagraphs([
    ...extractParagraphCandidates(articleBlock),
    ...extractParagraphCandidates(mainBlock),
  ]);

  const fallbackParagraphs = dedupeParagraphs(extractParagraphCandidates(sanitizedHtml));
  const mergedParagraphs = dedupeParagraphs([
    ...primaryParagraphs,
    ...contentBlocks.filter((item) => !looksNoisyParagraph(item)),
    ...fallbackParagraphs,
  ]).slice(0, 36);

  if (mergedParagraphs.length === 0) {
    return '';
  }

  return mergedParagraphs.join('\n\n');
}

function extractPrimaryParagraph(html: string) {
  const mainArticleText = extractMainArticleText(html);
  if (!mainArticleText) {
    return '';
  }
  const firstParagraph = mainArticleText.split('\n\n').find((paragraph) => paragraph.trim().length > 0);
  return firstParagraph?.trim() ?? '';
}

function extractClassValue(html: string, className: string) {
  const escapedClass = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<[^>]*class="[^"]*${escapedClass}[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'));
  if (!match?.[1]) {
    return '';
  }
  return normalizeWhitespace(stripHtml(match[1]));
}

function extractFirstHeading(html: string) {
  const headingMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (headingMatch?.[1]) {
    return normalizeWhitespace(stripHtml(headingMatch[1]));
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch?.[1] ? normalizeWhitespace(stripHtml(titleMatch[1])) : '';
}

function extractAttachmentNames(html: string) {
  const extensionPattern = '(?:xlsx|xls|docx|doc|pptx|ppt|pdf|zip|rar|odt|ods)';
  const filePattern = new RegExp(`([A-Za-z0-9 _\\-.]{3,160}\\.${extensionPattern})`, 'gi');
  const matches = [...html.matchAll(filePattern)]
    .map((match) => normalizeWhitespace(stripHtml(match[1] ?? '')))
    .filter((name) => name.length >= 5)
    .slice(0, 3);

  return [...new Set(matches)];
}

function buildPageDerivedSummary(html: string, item: RawFeedItem) {
  const heading = extractFirstHeading(html) || item.title;
  const unit = extractClassValue(html, 'announcement-detail-subtitle');
  const dateText = extractClassValue(html, 'announcement-detail-date');
  const attachments = extractAttachmentNames(html);

  const chunks: string[] = [];
  const headingText = normalizeTitleForSummary(heading, item.sourceName);
  if (headingText) {
    chunks.push(/[.!?]$/.test(headingText) ? headingText : `${headingText}.`);
  }

  if (unit && compactForCompare(unit) !== compactForCompare(item.sourceName)) {
    chunks.push(`Ilgili birim: ${unit}.`);
  }
  if (dateText) {
    chunks.push(`Kayitta gecen tarih: ${dateText}.`);
  }
  if (attachments.length > 0) {
    chunks.push(`Ek dosya: ${attachments.join(', ')}.`);
  }

  return normalizeWhitespace(chunks.join(' '));
}

function buildHighlights(title: string, summary: string, detailText: string) {
  const baseText = normalizeWhitespace(`${title}. ${summary}. ${detailText}`);
  const sentences = baseText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 30 && sentence.length <= 220);

  const highlights: string[] = [];
  const seen = new Set<string>();
  const titleCompact = compactForCompare(title);
  for (const sentence of sentences) {
    const compact = compactForCompare(sentence);
    if (!compact || seen.has(compact) || compact === titleCompact) {
      continue;
    }

    seen.add(compact);
    highlights.push(sentence);
    if (highlights.length >= 3) {
      break;
    }
  }

  if (highlights.length === 0 && summary.length > 0) {
    highlights.push(summary.length > 220 ? `${summary.slice(0, 217)}...` : summary);
    seen.add(compactForCompare(summary));
  }

  if (highlights.length < 2 && detailText.length > 0) {
    const detailCandidate = detailText.length > 220 ? `${detailText.slice(0, 217)}...` : detailText;
    const compact = compactForCompare(detailCandidate);
    if (compact && !seen.has(compact)) {
      highlights.push(detailCandidate);
    }
  }

  return highlights;
}

function estimateWordCount(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0).length;
}

function splitLongParagraph(paragraph: string, maxWords: number) {
  const wordCount = estimateWordCount(paragraph);
  if (wordCount <= maxWords) {
    return [paragraph];
  }

  const sentences = paragraph
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (sentences.length <= 1) {
    return [paragraph];
  }

  const chunks: string[] = [];
  let current = '';
  let currentWords = 0;

  for (const sentence of sentences) {
    const sentenceWords = estimateWordCount(sentence);
    if (currentWords > 0 && currentWords + sentenceWords > maxWords) {
      chunks.push(current.trim());
      current = sentence;
      currentWords = sentenceWords;
      continue;
    }
    current = current ? `${current} ${sentence}` : sentence;
    currentWords += sentenceWords;
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [paragraph];
}

function chunkArticleText(text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length === 0) {
    return [];
  }

  const preparedParagraphs = paragraphs.flatMap((paragraph) => splitLongParagraph(paragraph, NEWS_CHUNK_MAX_WORDS));
  const chunks: string[] = [];
  let currentParagraphs: string[] = [];
  let currentWords = 0;

  for (const paragraph of preparedParagraphs) {
    const paragraphWords = estimateWordCount(paragraph);
    if (
      currentWords >= NEWS_CHUNK_MIN_WORDS &&
      currentWords + paragraphWords > NEWS_CHUNK_MAX_WORDS &&
      currentParagraphs.length > 0
    ) {
      chunks.push(currentParagraphs.join('\n\n'));
      currentParagraphs = [paragraph];
      currentWords = paragraphWords;
      continue;
    }

    currentParagraphs.push(paragraph);
    currentWords += paragraphWords;

    if (currentWords >= NEWS_CHUNK_TARGET_WORDS) {
      chunks.push(currentParagraphs.join('\n\n'));
      currentParagraphs = [];
      currentWords = 0;
    }
  }

  if (currentParagraphs.length > 0) {
    chunks.push(currentParagraphs.join('\n\n'));
  }

  if (chunks.length <= NEWS_MAX_CHUNKS) {
    return chunks;
  }

  const head = chunks.slice(0, NEWS_MAX_CHUNKS - 1);
  const tail = chunks.slice(NEWS_MAX_CHUNKS - 1).join('\n\n');
  return [...head, tail];
}

function normalizeList(values: string[], maxItems: number) {
  const cleaned = values
    .map((item) => normalizeWhitespace(item))
    .filter((item) => item.length > 0)
    .slice(0, maxItems * 2);
  return [...new Set(cleaned)].slice(0, maxItems);
}

function extractNumbersFromText(text: string) {
  const matches = text.match(
    /\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?(?:\s*(?:TL|TRY|USD|EUR|%|yil|ay|gun|milyon|milyar))?\b/gi,
  ) ?? [];

  return normalizeList(
    matches.filter((entry) => entry.length >= 2),
    8,
  );
}

function buildSummaryCacheKey(url: string, articleText: string) {
  const contentHash = createHash('sha1').update(articleText.slice(0, 14000)).digest('hex');
  return `${canonicalizeUrl(url)}::${contentHash}`;
}

function buildFallbackStructuredSummary(item: RawFeedItem, articleText: string): StructuredNewsSummary {
  const fallbackSummary = normalizeSummary(
    articleText.length > 0 ? articleText : item.summary,
    item.title,
    item.sourceName,
    articleText,
  );
  const fallbackHighlights = buildHighlights(item.title, fallbackSummary, articleText);

  return {
    oneLiner: trimSummary(fallbackSummary),
    bullets: fallbackHighlights.slice(0, 3),
    whoWhatWhereWhen: {
      who: item.sourceName,
      what: item.title,
      where: 'belirtilmiyor',
      when: item.publishedAt ? item.publishedAt.slice(0, 10) : 'belirtilmiyor',
    },
    numbers: extractNumbersFromText(articleText),
    uncertainties: ['Kaynak metinde yer almayan bilgiler belirtilmiyor olarak birakildi.'],
  };
}

function bulletSupportScore(bullet: string, sourceText: string) {
  const bulletTokens = normalize(bullet)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));

  if (bulletTokens.length === 0) {
    return 1;
  }

  const normalizedSource = normalize(sourceText);
  const matchedCount = bulletTokens.reduce((count, token) => {
    if (normalizedSource.includes(token)) {
      return count + 1;
    }
    return count;
  }, 0);

  return matchedCount / bulletTokens.length;
}

function filterBulletsWithEvidence(bullets: string[], sourceText: string) {
  return bullets.filter((bullet) => bulletSupportScore(bullet, sourceText) >= 0.25);
}

function buildStructuredDetailText(summary: StructuredNewsSummary) {
  const lines = [
    `Kim: ${summary.whoWhatWhereWhen.who}.`,
    `Ne oldu: ${summary.whoWhatWhereWhen.what}.`,
    `Nerede: ${summary.whoWhatWhereWhen.where}.`,
    `Ne zaman: ${summary.whoWhatWhereWhen.when}.`,
  ];

  if (summary.numbers.length > 0) {
    lines.push(`Metindeki sayilar: ${summary.numbers.join(', ')}.`);
  }
  if (summary.uncertainties.length > 0) {
    lines.push(`Belirsizlikler: ${summary.uncertainties.join(' | ')}.`);
  }

  return normalizeWhitespace(lines.join(' '));
}

function normalizeStructuredSummary(
  candidate: {
    one_liner: string;
    bullets: string[];
    who_what_where_when?: {
      who: string;
      what: string;
      where: string;
      when: string;
    };
    numbers: string[];
    uncertainties: string[];
  },
  item: RawFeedItem,
  articleText: string,
): StructuredNewsSummary {
  const fallback = buildFallbackStructuredSummary(item, articleText);
  const baseBullets = normalizeList(candidate.bullets, 5);
  const supportedBullets = filterBulletsWithEvidence(baseBullets, articleText);
  const fallbackBullets = fallback.bullets.filter((bullet) => !supportedBullets.includes(bullet));
  const bullets = [...supportedBullets, ...fallbackBullets].slice(0, 5);

  return {
    oneLiner: trimSummary(normalizeWhitespace(candidate.one_liner || fallback.oneLiner)),
    bullets: bullets.length > 0 ? bullets : fallback.bullets,
    whoWhatWhereWhen: {
      who: normalizeWhitespace(candidate.who_what_where_when?.who ?? '') || fallback.whoWhatWhereWhen.who,
      what: normalizeWhitespace(candidate.who_what_where_when?.what ?? '') || fallback.whoWhatWhereWhen.what,
      where: normalizeWhitespace(candidate.who_what_where_when?.where ?? '') || fallback.whoWhatWhereWhen.where,
      when: normalizeWhitespace(candidate.who_what_where_when?.when ?? '') || fallback.whoWhatWhereWhen.when,
    },
    numbers: normalizeList(candidate.numbers, 8).length > 0 ? normalizeList(candidate.numbers, 8) : fallback.numbers,
    uncertainties: normalizeList(candidate.uncertainties, 6),
  };
}

function splitSummarySentences(text: string) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter((sentence) => sentence.length > 0);
}

function convertPublishableSummaryToStructured(
  item: RawFeedItem,
  articleText: string,
  publishableSummary: string,
): StructuredNewsSummary {
  const fallback = buildFallbackStructuredSummary(item, articleText);
  const sentences = splitSummarySentences(publishableSummary);
  const oneLiner = trimSummary(sentences[0] ?? publishableSummary);
  const sentenceBullets = sentences.slice(1, 6);
  const supportedBullets = filterBulletsWithEvidence(sentenceBullets, articleText);
  const fallbackBullets = fallback.bullets.filter((bullet) => !supportedBullets.includes(bullet));
  const bullets = [...supportedBullets, ...fallbackBullets].slice(0, 5);

  return {
    oneLiner: oneLiner || fallback.oneLiner,
    bullets: bullets.length > 0 ? bullets : fallback.bullets,
    whoWhatWhereWhen: {
      who: item.sourceName,
      what: oneLiner || item.title,
      where: 'belirtilmiyor',
      when: item.publishedAt ? item.publishedAt.slice(0, 10) : 'belirtilmiyor',
    },
    numbers: extractNumbersFromText(`${publishableSummary} ${articleText}`),
    uncertainties: [],
  };
}

function tokenizeForExtractiveScore(text: string) {
  return normalize(text)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

function splitIntoCandidateSentences(articleText: string) {
  const sentences = articleText
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter((sentence) => sentence.length >= 45 && sentence.length <= 320);

  const uniqueSentences: string[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    const compact = compactForCompare(sentence);
    if (!compact || seen.has(compact)) {
      continue;
    }
    seen.add(compact);
    uniqueSentences.push(sentence);
  }

  return uniqueSentences;
}

function sentenceSignalScore(sentence: string) {
  const normalized = normalize(sentence);
  let score = 0;

  if (/\d/.test(sentence)) {
    score += 0.35;
  }
  if (/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(sentence)) {
    score += 0.4;
  }

  const legalSignals = [
    'kanun',
    'yonetmelik',
    'teblig',
    'karar',
    'mahkeme',
    'duyuru',
    'yururluk',
    'son tarih',
    'idari para cezasi',
    'kurul',
  ];
  if (legalSignals.some((signal) => normalized.includes(signal))) {
    score += 0.25;
  }

  return score;
}

function resolveExtractiveSentenceBudget(articleText: string, candidateCount: number) {
  if (candidateCount <= 0) {
    return { minSentences: 0, maxSentences: 0 };
  }

  const wordCount = estimateWordCount(articleText);

  let minSentences = 8;
  let maxSentences = 12;
  if (wordCount < 260 || candidateCount <= 7) {
    minSentences = 5;
    maxSentences = 7;
  } else if (wordCount < 500 || candidateCount <= 10) {
    minSentences = 6;
    maxSentences = 8;
  } else if (wordCount < 900 || candidateCount <= 14) {
    minSentences = 8;
    maxSentences = 10;
  } else {
    minSentences = 10;
    maxSentences = 12;
  }

  minSentences = Math.max(1, Math.min(minSentences, candidateCount));
  maxSentences = Math.max(minSentences, Math.min(maxSentences, candidateCount));

  return { minSentences, maxSentences };
}

function selectExtractiveSentences(articleText: string) {
  const sentences = splitIntoCandidateSentences(articleText);
  const { minSentences, maxSentences } = resolveExtractiveSentenceBudget(articleText, sentences.length);
  if (sentences.length === 0) {
    return {
      sentences: [] as string[],
      minSentences: 0,
      maxSentences: 0,
    };
  }

  if (sentences.length <= minSentences) {
    return {
      sentences,
      minSentences,
      maxSentences,
    };
  }

  const tokenFrequency = new Map<string, number>();
  for (const sentence of sentences) {
    const uniqueTokens = [...new Set(tokenizeForExtractiveScore(sentence))];
    for (const token of uniqueTokens) {
      tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
    }
  }

  const maxFrequency = Math.max(...tokenFrequency.values(), 1);
  const scored = sentences.map((sentence, index) => {
    const tokens = [...new Set(tokenizeForExtractiveScore(sentence))];
    const tfScore =
      tokens.length === 0
        ? 0
        : tokens.reduce((sum, token) => sum + ((tokenFrequency.get(token) ?? 0) / maxFrequency), 0) / tokens.length;

    let positionBoost = 0;
    if (index === 0) {
      positionBoost += 0.7;
    } else if (index <= 2) {
      positionBoost += 0.35;
    }
    if (index >= sentences.length - 2) {
      positionBoost += 0.2;
    }

    return {
      index,
      sentence,
      score: tfScore + positionBoost + sentenceSignalScore(sentence),
    };
  });

  const ratioTarget = Math.round(sentences.length * 0.24);
  const densityTarget = Math.round(estimateWordCount(articleText) / 120);
  const desiredCount = Math.max(
    minSentences,
    Math.min(maxSentences, Math.max(ratioTarget, densityTarget)),
  );
  const selected = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, desiredCount)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence);

  return {
    sentences: selected.slice(0, maxSentences),
    minSentences,
    maxSentences,
  };
}

async function summarizeArticleWithHybridApproach(item: RawFeedItem, articleText: string) {
  const modelSelection = await getNewsSummaryModel();
  if (!modelSelection) {
    return null;
  }

  const extractiveSelection = selectExtractiveSentences(articleText);
  const extractiveSentences = extractiveSelection.sentences;
  if (extractiveSentences.length === 0) {
    return null;
  }

  const extractiveContext = extractiveSentences
    .map((sentence, index) => `${index + 1}. ${sentence}`)
    .join('\n');

  const prompt = [
    'Sen hukuk odakli bir haber editorsun. Sana verilen icerikten, hukukcular icin yayinlanabilir nitelikte Turkce haber ozeti uret.',
    '',
    'GOREV:',
    '- Metni dikkatle oku ve SADECE verilen icerikte acikca yer alan bilgilere dayan.',
    '- Ozet en az 6 en fazla 8 cumle olsun.',
    '- Ilk cumle haberin ozunu dogrudan anlatsin.',
    '- Dogal, akici, profesyonel haber dili kullan.',
    '- Boilerplate/fallback dili kullanma.',
    '- Metinde acikca gecmeyen bilgi ekleme, yorum yapma, tahmin yuruttme.',
    '- Icerik yetersizse ozet uydurma.',
    '',
    'YASAKLAR:',
    '- "... kaynaginda ... baslikli yeni bir guncelleme yayimlandi."',
    '- "Ayrintilar icin kaynak baglantisini acin."',
    '- "Bu kayit otomatik haber akisindan alinmistir."',
    '- "Kamuoyuyla paylasildi."',
    '- "Detaylar resmi aciklamada yer aldi."',
    '',
    'CIKTI FORMATI (yalnizca JSON):',
    '{"publishable": true, "summary": "tek paragraf halinde, 6-8 cumlelik yayinlanabilir ozet"}',
    'veya',
    '{"publishable": false, "summary": ""}',
    '',
    `Baslik: ${item.title}`,
    `Kaynak: ${item.sourceName}`,
    `Link: ${item.link || item.sourceUrl}`,
    `Yayin tarihi: ${item.publishedAt}`,
    `Icerik (${extractiveSelection.minSentences}-${extractiveSelection.maxSentences}, secilen=${extractiveSentences.length}):`,
    extractiveContext,
  ].join('\n');

  try {
    const { object } = await generateObject({
      model: modelSelection.model,
      schema: publishableSummarySchema,
      prompt,
      temperature: 0,
    });
    const publishableSummary = normalizeWhitespace(object.summary ?? '');
    const summarySentenceCount = splitSummarySentences(publishableSummary).length;
    const looksValidPublishableSummary =
      object.publishable &&
      publishableSummary.length > 0 &&
      summarySentenceCount >= 6 &&
      summarySentenceCount <= 8 &&
      !hasLowQualitySnippet(publishableSummary);

    if (looksValidPublishableSummary) {
      return convertPublishableSummaryToStructured(item, articleText, publishableSummary);
    }

    const extractiveFallback = normalizeWhitespace(extractiveSentences.join(' '));
    if (extractiveFallback.length > 0) {
      return convertPublishableSummaryToStructured(item, articleText, extractiveFallback);
    }

    return null;
  } catch {
    const fallbackBullets = buildHighlights(
      item.title,
      trimSummary(extractiveSentences.join(' ')),
      extractiveSentences.join(' '),
    ).slice(0, 5);

    return normalizeStructuredSummary(
      {
        one_liner: trimSummary(extractiveSentences[0] ?? item.title),
        bullets: fallbackBullets.length > 0 ? fallbackBullets : extractiveSentences.slice(0, 5),
        who_what_where_when: {
          who: item.sourceName,
          what: item.title,
          where: 'belirtilmiyor',
          when: item.publishedAt ? item.publishedAt.slice(0, 10) : 'belirtilmiyor',
        },
        numbers: extractNumbersFromText(extractiveSentences.join(' ')),
        uncertainties: ['Model ozeti uretilemedi; extractive fallback kullanildi.'],
      },
      item,
      articleText,
    );
  }
}

function shouldUseModelSummary(summary: string, detailText: string, mainArticleText: string) {
  if (!hasSummaryModelConfig()) {
    return false;
  }
  if (mainArticleText.length < 420) {
    return false;
  }
  if (looksThinSummary(summary) || isFallbackSummary(summary) || isFallbackDetail(detailText)) {
    return true;
  }
  return mainArticleText.length >= 2000;
}

function looksThinSummary(summary: string) {
  const normalized = normalize(summary);
  if (normalized.length < 90) {
    return true;
  }
  if (normalized.includes('google news') || normalized.includes('x.com')) {
    return true;
  }
  return false;
}

async function enrichSingleRawItem(item: RawFeedItem, aiSummaryBudget: { remaining: number }): Promise<RawFeedItem> {
  const currentSummary = normalizeSummary(item.summary, item.title, item.sourceName, item.detailText ?? '');
  const currentDetailText = normalizeDetail(item.detailText ?? '', currentSummary, item.title);
  let resolvedLink = item.link;
  const resolveTrustState = (linkValue: string, sourceUrlValue: string) => {
    return isTrustedSource({
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      link: linkValue || item.link,
      sourceUrl: sourceUrlValue || item.sourceUrl,
    });
  };

  // As a second chance, try decoding unresolved Google News links per-item.
  if (isGoogleNewsUrl(resolvedLink)) {
    const decoder = await getGoogleDecoder();
    if (decoder) {
      try {
        const decoded = await decoder.decode(resolvedLink);
        const decodedUrl = decoded.decoded_url?.trim();
        if (decoded.status && decodedUrl && isHttpUrl(decodedUrl) && !isGoogleNewsUrl(decodedUrl)) {
          resolvedLink = canonicalizeUrl(decodedUrl);
        }
      } catch {
        // Best-effort decode; fall back to existing summary/detail.
      }
    }
  }

  // If it is still a Google News shell URL, skip source fetch to avoid low-value pages.
  if (isGoogleNewsUrl(resolvedLink)) {
    const fallbackHighlights = buildHighlights(item.title, currentSummary, currentDetailText);
    return {
      ...item,
      link: resolvedLink,
      sourceUrl: resolvedLink,
      summary: currentSummary,
      detailText: currentDetailText,
      highlights: item.highlights?.length ? item.highlights : fallbackHighlights,
      isWhitelistedSource: resolveTrustState(resolvedLink, resolvedLink),
    };
  }

  const shouldFetchFromSource = Boolean(resolvedLink);
  if (!shouldFetchFromSource) {
    const fallbackHighlights = buildHighlights(item.title, currentSummary, currentDetailText);
    return {
      ...item,
      link: resolvedLink || item.link,
      sourceUrl: resolvedLink || item.sourceUrl,
      summary: currentSummary,
      detailText: currentDetailText,
      highlights: item.highlights?.length ? item.highlights : fallbackHighlights,
      isWhitelistedSource: resolveTrustState(resolvedLink || item.link, resolvedLink || item.sourceUrl),
    };
  }

  try {
    const response = await fetchTextWithTimeout(resolvedLink, NEWS_ARTICLE_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      const fallbackHighlights = buildHighlights(item.title, currentSummary, currentDetailText);
      return {
        ...item,
        link: resolvedLink,
        sourceUrl: resolvedLink,
        summary: currentSummary,
        detailText: currentDetailText,
        highlights: item.highlights?.length ? item.highlights : fallbackHighlights,
        isWhitelistedSource: resolveTrustState(resolvedLink, resolvedLink),
      };
    }

    const html = await response.text();
    const metaDescriptionRaw = extractMetaDescription(html);
    const paragraphRaw = extractPrimaryParagraph(html);
    const mainArticleTextRaw = extractMainArticleText(html);
    const pageDerivedSummary = buildPageDerivedSummary(html, item);
    const metaDescription = hasLowQualitySnippet(metaDescriptionRaw) ? '' : metaDescriptionRaw;
    const paragraph = hasLowQualitySnippet(paragraphRaw) ? '' : paragraphRaw;
    const mainArticleText = mainArticleTextRaw
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const compactMainArticleText = normalizeWhitespace(mainArticleText);
    const extractedDetailText = normalizeWhitespace(
      [metaDescription, paragraph, compactMainArticleText].filter((part) => part.length > 0).join(' '),
    );

    const bestAvailableTextForSummary =
      mainArticleText.length > 0
        ? mainArticleText
        : extractedDetailText.length > 0
          ? extractedDetailText
          : pageDerivedSummary;

    let structuredSummary: StructuredNewsSummary | null = null;
    if (shouldUseModelSummary(currentSummary, currentDetailText, bestAvailableTextForSummary)) {
      const cacheKey = buildSummaryCacheKey(resolvedLink || item.sourceUrl, bestAvailableTextForSummary);
      const cachedSummary = getCachedSummary(cacheKey);
      if (cachedSummary) {
        structuredSummary = cachedSummary;
      } else if (consumeSummaryBudget(aiSummaryBudget)) {
        structuredSummary = await summarizeArticleWithHybridApproach(item, bestAvailableTextForSummary);
        if (structuredSummary) {
          setCachedSummary(cacheKey, structuredSummary);
        }
      }
    }

    if (structuredSummary) {
      const structuredDetailText = buildStructuredDetailText(structuredSummary);
      const mergedSummary = trimSummary(
        normalizeSummary(structuredSummary.oneLiner, item.title, item.sourceName, structuredDetailText),
      );
      const mergedDetailText = normalizeDetail(structuredDetailText, mergedSummary, item.title);
      const highlights = structuredSummary.bullets.length > 0
        ? structuredSummary.bullets.slice(0, 3)
        : buildHighlights(item.title, mergedSummary, mergedDetailText);

      return {
        ...item,
        link: resolvedLink,
        sourceUrl: resolvedLink,
        summary: mergedSummary,
        detailText: mergedDetailText,
        highlights,
        isWhitelistedSource: resolveTrustState(resolvedLink, resolvedLink),
      };
    }

    const fallbackBestText = normalizeWhitespace(
      [
        pageDerivedSummary,
        metaDescription,
        paragraph,
        compactMainArticleText.length > 1200
          ? `${compactMainArticleText.slice(0, 1197)}...`
          : compactMainArticleText,
      ].filter((part) => part.length > 0).join(' '),
    );
    const extractiveFallbackSelection = selectExtractiveSentences(bestAvailableTextForSummary);
    const extractiveFallbackText = normalizeWhitespace(extractiveFallbackSelection.sentences.join(' '));
    const fallbackSummarySeed =
      extractiveFallbackSelection.sentences[0] ||
      (fallbackBestText.length > 0 ? fallbackBestText : currentSummary);
    const fallbackDetailSeed = extractiveFallbackText.length > 0 ? extractiveFallbackText : fallbackBestText;
    const mergedSummary = trimSummary(
      normalizeSummary(
        fallbackSummarySeed,
        item.title,
        item.sourceName,
        `${fallbackDetailSeed} ${currentDetailText}`,
      ),
    );
    const mergedDetailText = normalizeDetail(fallbackDetailSeed, mergedSummary, item.title);
    const highlights = buildHighlights(item.title, mergedSummary, mergedDetailText);

    return {
      ...item,
      link: resolvedLink,
      sourceUrl: resolvedLink,
      summary: mergedSummary,
      detailText: mergedDetailText,
      highlights: highlights.length > 0 ? highlights : buildHighlights(item.title, mergedSummary, ''),
      isWhitelistedSource: resolveTrustState(resolvedLink, resolvedLink),
    };
  } catch {
    const fallbackHighlights = buildHighlights(item.title, currentSummary, currentDetailText);
    return {
      ...item,
      summary: currentSummary || item.title,
      detailText: currentDetailText,
      highlights: fallbackHighlights,
      isWhitelistedSource: resolveTrustState(item.link, item.sourceUrl),
    };
  }
}

async function enrichRawItemsWithContent(items: RawFeedItem[], enrichLimit = NEWS_ENRICH_LIMIT) {
  const toEnrichCount = Math.min(items.length, Math.max(enrichLimit, 0));
  const highPriorityItems = items.slice(0, toEnrichCount);
  const remainingItems = items.slice(toEnrichCount);
  const concurrency = NEWS_ENRICH_CONCURRENCY;
  const enriched: RawFeedItem[] = [];
  const aiSummaryBudget = { remaining: NEWS_SUMMARY_BUDGET_PER_RUN };

  for (let index = 0; index < highPriorityItems.length; index += concurrency) {
    const batch = highPriorityItems.slice(index, index + concurrency);
    const batchResults = await Promise.all(batch.map((item) => enrichSingleRawItem(item, aiSummaryBudget)));
    enriched.push(...batchResults);
  }

  const remainingNormalized = remainingItems.map((item) => {
    const summary = normalizeSummary(item.summary, item.title, item.sourceName, item.detailText ?? '');
    const detailText = normalizeDetail(item.detailText ?? '', summary, item.title);
    const trusted = isTrustedSource({
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      link: item.link,
    });
    return {
      ...item,
      summary,
      detailText,
      highlights: item.highlights?.length ? item.highlights : buildHighlights(item.title, summary, detailText),
      isWhitelistedSource: trusted,
    };
  });

  return [...enriched, ...remainingNormalized];
}

async function fetchTextWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Marinantex-NewsBot/1.0 (+https://marinantex.local)',
      },
      cache: 'no-store',
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function buildGoogleNewsUrl(source: DomainSourceConfig) {
  const searchQuery = `site:${source.domain} (${source.searchTerms.join(' OR ')}) ${GOOGLE_NEWS_RECENCY_FILTER}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=tr&gl=TR&ceid=TR:tr`;
}

async function fetchGoogleNewsSource(source: DomainSourceConfig): Promise<FetchResult> {
  const endpoint = buildGoogleNewsUrl(source);
  const startedAt = Date.now();

  try {
    const response = await fetchTextWithTimeout(endpoint, NEWS_SOURCE_FETCH_TIMEOUT_MS);
    const elapsed = Date.now() - startedAt;
    if (!response.ok) {
      return {
        status: {
          id: source.id,
          name: source.name,
          endpoint,
          transport: 'rss',
          success: false,
          itemCount: 0,
          latencyMs: elapsed,
          error: `HTTP ${response.status}`,
        },
        items: [],
      };
    }

    const xmlText = await response.text();
    const parsedItems = parseRssOrAtom(xmlText, source.name, source.websiteUrl, source.id).slice(0, NEWS_SOURCE_ITEMS_PER_FEED);

    return {
      status: {
        id: source.id,
        name: source.name,
        endpoint,
        transport: 'rss',
        success: true,
        itemCount: parsedItems.length,
        latencyMs: elapsed,
      },
      items: parsedItems,
    };
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    return {
      status: {
        id: source.id,
        name: source.name,
        endpoint,
        transport: 'rss',
        success: false,
        itemCount: 0,
        latencyMs: elapsed,
        error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      },
      items: [],
    };
  }
}

type XApiResponse = {
  data?: Array<{ id: string; text: string; created_at?: string; author_id?: string }>;
  includes?: { users?: Array<{ id: string; username?: string; name?: string }> };
};

async function fetchTwitterSource(): Promise<FetchResult> {
  const endpoint = 'https://api.x.com/2/tweets/search/recent';
  const startedAt = Date.now();
  const bearerToken = process.env.X_BEARER_TOKEN?.trim();

  if (!bearerToken) {
    const fallbackEndpoint =
      'https://news.google.com/rss/search?q=' +
      encodeURIComponent('site:x.com (mevzuat OR duyuru OR karar OR kvkk OR yargitay)') +
      '&hl=tr&gl=TR&ceid=TR:tr';

    try {
      const response = await fetchTextWithTimeout(fallbackEndpoint, NEWS_SOURCE_FETCH_TIMEOUT_MS);
      const elapsed = Date.now() - startedAt;
      if (!response.ok) {
        return {
          status: {
            id: 'x-twitter',
            name: 'X',
            endpoint: fallbackEndpoint,
            transport: 'rss',
            success: false,
            itemCount: 0,
            latencyMs: elapsed,
            error: `HTTP ${response.status} (fallback)`,
          },
          items: [],
        };
      }

      const xmlText = await response.text();
      const items = parseRssOrAtom(xmlText, 'X', 'https://x.com', 'x-twitter').slice(0, NEWS_X_FALLBACK_ITEMS_PER_FEED);

      return {
        status: {
          id: 'x-twitter',
          name: 'X',
          endpoint: fallbackEndpoint,
          transport: 'rss',
          success: true,
          itemCount: items.length,
          latencyMs: elapsed,
        },
        items,
      };
    } catch (error) {
      return {
        status: {
          id: 'x-twitter',
          name: 'X',
          endpoint: fallbackEndpoint,
          transport: 'rss',
          success: false,
          itemCount: 0,
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : 'X fallback hatasi',
        },
        items: [],
      };
    }
  }

  const accounts = (process.env.NEWS_X_ACCOUNTS ?? DEFAULT_TRUSTED_X_ACCOUNTS)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const accountClause = accounts.length > 0 ? `(${accounts.map((item) => `from:${item}`).join(' OR ')})` : '';
  const topicClause = '(mevzuat OR duyuru OR karar OR ictihat OR yargi OR kvkk)';
  const query = `${accountClause} ${topicClause} -is:retweet`.trim();

  const url = `${endpoint}?query=${encodeURIComponent(query)}&max_results=20&tweet.fields=created_at,author_id&expansions=author_id&user.fields=username,name`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    });

    const elapsed = Date.now() - startedAt;
    if (!response.ok) {
      return {
        status: {
          id: 'x-twitter',
          name: 'X',
          endpoint,
          transport: 'x-api',
          success: false,
          itemCount: 0,
          latencyMs: elapsed,
          error: `HTTP ${response.status}`,
        },
        items: [],
      };
    }

    const payload = (await response.json()) as XApiResponse;
    const usersById = new Map((payload.includes?.users ?? []).map((user) => [user.id, user]));

    const items: RawFeedItem[] = (payload.data ?? []).map((tweet) => {
      const user = tweet.author_id ? usersById.get(tweet.author_id) : undefined;
      const username = user?.username ?? 'x-kaynak';
      const title = stripHtml(tweet.text).slice(0, 160);
      const sourceUrl = `https://x.com/${username}`;
      const link = `https://x.com/${username}/status/${tweet.id}`;

      return {
        sourceId: 'x-twitter',
        sourceName: `X / @${username}`,
        sourceUrl,
        title: title.length > 0 ? title : 'X paylasimi',
        link,
        publishedAt: toIsoDate(tweet.created_at ?? new Date().toISOString()),
        summary: trimSummary(stripHtml(tweet.text)),
        isWhitelistedSource: isTrustedSource({
          sourceId: 'x-twitter',
          sourceName: `X / @${username}`,
          sourceUrl,
          link,
        }),
      };
    });

    return {
      status: {
        id: 'x-twitter',
        name: 'X',
        endpoint,
        transport: 'x-api',
        success: true,
        itemCount: items.length,
        latencyMs: elapsed,
      },
      items,
    };
  } catch (error) {
    return {
      status: {
        id: 'x-twitter',
        name: 'X',
        endpoint,
        transport: 'x-api',
        success: false,
        itemCount: 0,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      },
      items: [],
    };
  }
}

function classifyCategory(text: string): NewsCategory {
  const normalizedText = normalize(text);
  const matchedRule = CATEGORY_RULES.find((rule) => rule.keywords.some((keyword) => normalizedText.includes(keyword)));
  return matchedRule?.category ?? 'Sektorel';
}

function classifySeverity(text: string): NewsSeverity {
  const normalizedText = normalize(text);
  if (CRITICAL_SEVERITY_KEYWORDS.some((keyword) => normalizedText.includes(keyword))) {
    return 'kritik';
  }
  if (MEDIUM_SEVERITY_KEYWORDS.some((keyword) => normalizedText.includes(keyword))) {
    return 'orta';
  }
  return 'bilgi';
}

function inferWorkspaces(text: string): WorkspaceTag[] {
  const normalizedText = normalize(text);
  const matched = WORKSPACE_RULES.filter((rule) => rule.keywords.some((keyword) => normalizedText.includes(keyword))).map((rule) => rule.workspace);
  if (matched.length > 0) {
    return [...new Set(matched)];
  }
  return ['icra'];
}

function inferTags(title: string, summary: string, workspaces: WorkspaceTag[]) {
  const normalizedText = normalize(`${title} ${summary}`);
  const tags = new Set<string>();

  workspaces.forEach((workspace) => tags.add(workspace));
  if (normalizedText.includes('duyuru')) tags.add('duyuru');
  if (normalizedText.includes('kanun')) tags.add('kanun');
  if (normalizedText.includes('teblig')) tags.add('teblig');
  if (normalizedText.includes('karar')) tags.add('karar');
  if (normalizedText.includes('rehber')) tags.add('rehber');
  if (normalizedText.includes('yururluk')) tags.add('yururluk');

  const titleTokens = normalizedText
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
    .slice(0, 4);

  titleTokens.forEach((token) => tags.add(token));

  return [...tags].slice(0, 6);
}

function getCaseSearchText(caseItem: DashboardCaseLite) {
  return normalize(`${caseItem.title} ${caseItem.fileNo ?? ''} ${caseItem.clientDisplayName ?? ''} ${caseItem.tags.join(' ')}`);
}

function suggestImpactedCases(item: Pick<LiveNewsItem, 'title' | 'summary' | 'tags' | 'workspaces'>, activeCases: DashboardCaseLite[]) {
  const titleTokens = normalize(item.title)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
    .slice(0, 8);

  const scored = activeCases
    .map((caseItem) => {
      const haystack = getCaseSearchText(caseItem);
      let score = 0;
      const reasons: string[] = [];

      const matchedWorkspaces = item.workspaces.filter((workspace) => haystack.includes(workspace));
      if (matchedWorkspaces.length > 0) {
        score += matchedWorkspaces.length * 3;
        reasons.push(`calisma alani: ${matchedWorkspaces.join(', ')}`);
      }

      const matchedTags = item.tags.filter((tag) => haystack.includes(normalize(tag)));
      if (matchedTags.length > 0) {
        score += matchedTags.length * 2;
        reasons.push(`etiket: ${matchedTags.slice(0, 3).join(', ')}`);
      }

      const matchedTokens = titleTokens.filter((token) => haystack.includes(token));
      if (matchedTokens.length > 0) {
        score += matchedTokens.length;
        reasons.push(`konu: ${matchedTokens.slice(0, 3).join(', ')}`);
      }

      return {
        caseItem,
        score,
        reason: reasons.join(' | '),
      };
    })
    .filter((entry) => entry.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return scored.map((entry) => ({
    id: entry.caseItem.id,
    title: entry.caseItem.title,
    reason: entry.reason || 'konu benzerligi',
  }));
}

function buildActionDraft(category: NewsCategory, severity: NewsSeverity, workspaces: WorkspaceTag[]) {
  const actions = [
    'Kaynak metni ac ve degisikligin kapsamini dogrula.',
    'Etkilenen dosyalarda gorev acip sorumlu kisiye ata.',
  ];

  if (category === 'Mevzuat') {
    actions.push('Yururluk tarihini dosya takvimine isle ve son tarihleri guncelle.');
  }
  if (category === 'Ictihat') {
    actions.push('Emsal karari ilgili dilekce/ictihat notuna bagla.');
  }
  if (workspaces.includes('kvkk')) {
    actions.push('Muvekkil veri uyum listesinde risk taramasini yenile.');
  }
  if (severity === 'kritik') {
    actions.push('Muvekkile bilgilendirme taslagi hazirlayip onaya gonder.');
  }

  return actions.slice(0, 4);
}

function mapRawToLiveItem(rawItem: RawFeedItem, activeCases: DashboardCaseLite[]): LiveNewsItem {
  const summary = trimSummary(normalizeSummary(rawItem.summary, rawItem.title, rawItem.sourceName, rawItem.detailText ?? ''));
  const detailText = normalizeDetail(rawItem.detailText ?? '', summary, rawItem.title);
  const highlights = rawItem.highlights?.length ? rawItem.highlights : buildHighlights(rawItem.title, summary, detailText);
  const textCorpus = `${rawItem.title} ${summary} ${detailText}`;
  const category = classifyCategory(textCorpus);
  const severity = classifySeverity(textCorpus);
  const workspaces = inferWorkspaces(textCorpus);
  const tags = inferTags(rawItem.title, `${summary} ${detailText}`, workspaces);

  const previewItem: LiveNewsItem = {
    id: buildItemId([rawItem.sourceId, rawItem.link, rawItem.title, rawItem.publishedAt]),
    title: rawItem.title,
    source: rawItem.sourceName,
    sourceUrl: rawItem.link || rawItem.sourceUrl,
    publishedAt: rawItem.publishedAt,
    updatedAt: rawItem.updatedAt,
    category,
    severity,
    tags,
    workspaces,
    summary,
    detailText,
    highlights,
    impactCases: [],
    actionDraft: buildActionDraft(category, severity, workspaces),
    isWhitelistedSource: rawItem.isWhitelistedSource,
  };

  return {
    ...previewItem,
    impactCases: suggestImpactedCases(previewItem, activeCases),
  };
}

function dedupeItems(items: RawFeedItem[]) {
  const uniqueMap = new Map<string, RawFeedItem>();
  for (const item of items) {
    const dedupeKey = `${canonicalizeUrl(item.link)}::${normalize(item.title)}`;
    const existing = uniqueMap.get(dedupeKey);
    if (!existing) {
      uniqueMap.set(dedupeKey, item);
      continue;
    }

    const existingScore = (existing.detailText?.length ?? 0) + existing.summary.length;
    const incomingScore = (item.detailText?.length ?? 0) + item.summary.length;
    if (incomingScore > existingScore) {
      uniqueMap.set(dedupeKey, item);
    }
  }
  return [...uniqueMap.values()];
}

function getContentFingerprint(item: RawFeedItem) {
  const normalizedContent = compactForCompare(
    `${item.title} ${item.summary} ${(item.detailText ?? '').slice(0, 1200)}`,
  );
  if (!normalizedContent) {
    return '';
  }
  return createHash('sha1').update(normalizedContent).digest('hex').slice(0, 18);
}

function dedupeByContentFingerprint(items: RawFeedItem[]) {
  const byFingerprint = new Map<string, RawFeedItem>();
  for (const item of items) {
    const fingerprint = getContentFingerprint(item);
    if (!fingerprint) {
      const fallbackKey = buildItemId([item.sourceId, item.link, item.title]);
      byFingerprint.set(fallbackKey, item);
      continue;
    }

    const existing = byFingerprint.get(fingerprint);
    if (!existing) {
      byFingerprint.set(fingerprint, item);
      continue;
    }

    const existingScore = (existing.detailText?.length ?? 0) + existing.summary.length;
    const incomingScore = (item.detailText?.length ?? 0) + item.summary.length;
    if (incomingScore > existingScore) {
      byFingerprint.set(fingerprint, item);
    }
  }

  return [...byFingerprint.values()];
}

function legalRelevanceScore(item: RawFeedItem) {
  const textCorpus = normalize(`${item.title} ${item.summary} ${item.detailText ?? ''} ${item.sourceName}`);
  const positiveMatches = LEGAL_RELEVANCE_KEYWORDS.reduce((count, keyword) => {
    return textCorpus.includes(keyword) ? count + 1 : count;
  }, 0);
  const negativeMatches = LOW_LEGAL_RELEVANCE_KEYWORDS.reduce((count, keyword) => {
    return textCorpus.includes(keyword) ? count + 1 : count;
  }, 0);

  let score = 0;
  if (item.isWhitelistedSource) {
    score += 1.35;
  }
  if (hasStrongNewsSignal(textCorpus)) {
    score += 1.1;
  }
  score += Math.min(positiveMatches * 0.45, 2.25);
  score -= Math.min(negativeMatches * 0.5, 1.5);

  if (item.sourceId === 'x-twitter' && positiveMatches < 2) {
    score -= 0.7;
  }
  if (isGenericTitle(item.title, item.sourceName) && positiveMatches === 0) {
    score -= 0.9;
  }

  return score;
}

function filterLowQualityItems(items: RawFeedItem[]) {
  return items.filter((item) => {
    const summaryEchoesTitle = isTextEchoingTitle(item.summary, item.title);
    const detailEchoesTitle = isTextEchoingTitle(item.detailText ?? '', item.title);
    const textCorpus = `${item.title} ${item.summary} ${item.detailText ?? ''}`;
    const hasStructuredSignals = hasConcreteContext(textCorpus);
    const summaryLength = normalizeWhitespace(item.summary).length;
    const detailLength = normalizeWhitespace(item.detailText ?? '').length;
    const detailSentenceCount = splitSummarySentences(item.detailText ?? '').length;
    const relevanceScore = legalRelevanceScore(item);

    if (relevanceScore < LEGAL_RELEVANCE_MIN_SCORE) {
      return false;
    }

    if (summaryEchoesTitle && detailEchoesTitle) {
      return false;
    }
    if (detailEchoesTitle && detailSentenceCount < 2 && detailLength < 220) {
      return false;
    }
    if (/^\d{3,}\.pdf\b/i.test(item.title) && detailLength < 120) {
      return false;
    }
    if ((summaryLength < 80 || detailLength < 110) && detailSentenceCount < 2 && !hasStructuredSignals) {
      return false;
    }

    const titleIsGeneric = isGenericTitle(item.title, item.sourceName);
    if (!titleIsGeneric) {
      return true;
    }
    // Baslik cok genelse ancak somut birikim (tarih/birim/ek dosya) varsa goster.
    if (!hasStructuredSignals) {
      return false;
    }
    if (!hasStrongNewsSignal(textCorpus)) {
      return false;
    }
    // Baslik cok genelse ve halen fallback metnindeyse akis gurultusunu azalt.
    return !isFallbackSummary(item.summary) && !isFallbackDetail(item.detailText ?? '');
  });
}

function contentRichnessScore(item: RawFeedItem) {
  const summaryLength = normalizeWhitespace(item.summary).length;
  const detailText = normalizeWhitespace(item.detailText ?? '');
  const detailLength = detailText.length;
  const detailSentenceCount = splitSummarySentences(detailText).length;
  const textCorpus = `${item.title} ${item.summary} ${item.detailText ?? ''}`;

  let score = 0;
  score += Math.min(summaryLength, 240) / 100;
  score += Math.min(detailLength, 700) / 150;
  if (detailSentenceCount >= 2) {
    score += 1.3;
  }
  if (hasConcreteContext(textCorpus)) {
    score += 1.0;
  }
  if (hasStrongNewsSignal(textCorpus)) {
    score += 1.1;
  }
  if (isTextEchoingTitle(item.summary, item.title)) {
    score -= 1.4;
  }
  if (isTextEchoingTitle(item.detailText ?? '', item.title)) {
    score -= 1.7;
  }
  if (isFallbackSummary(item.summary) || isFallbackDetail(item.detailText ?? '')) {
    score -= 2.2;
  }
  score += legalRelevanceScore(item) * 0.35;

  return score;
}

function rankItemsByQualityAndRecency(items: RawFeedItem[]) {
  return [...items].sort((a, b) => {
    const scoreDiff = contentRichnessScore(b) - contentRichnessScore(a);
    if (Math.abs(scoreDiff) > 0.01) {
      return scoreDiff;
    }
    return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  });
}

function getCachedPreparedNewsSnapshot() {
  if (!preparedNewsSnapshotCache) {
    return null;
  }
  if (preparedNewsSnapshotCache.expiresAt <= Date.now()) {
    preparedNewsSnapshotCache = null;
    return null;
  }
  return preparedNewsSnapshotCache.value;
}

function setCachedPreparedNewsSnapshot(value: PreparedNewsSnapshot) {
  const ttlMs = value.rawItems.length > 0 ? DASHBOARD_NEWS_SNAPSHOT_TTL_MS : EMPTY_SNAPSHOT_TTL_MS;
  if (value.rawItems.length > 0) {
    lastNonEmptyPreparedNewsSnapshot = value;
  }
  preparedNewsSnapshotCache = {
    value,
    expiresAt: Date.now() + ttlMs,
  };
}

async function buildPreparedNewsSnapshot(): Promise<PreparedNewsSnapshot> {
  const sourceResults = await Promise.all([
    ...GOOGLE_NEWS_SOURCES.map((source) => fetchGoogleNewsSource(source)),
    fetchTwitterSource(),
  ]);

  const sourceHealth = sourceResults.map((result) => result.status);
  const rawItems = sourceResults.flatMap((result) => result.items);
  const resolvedRawItems = await resolveGoogleNewsLinks(rawItems);
  const dedupedRawItems = dedupeItems(resolvedRawItems)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, NEWS_CANDIDATE_POOL_LIMIT);
  const enrichedRawItems = await enrichRawItemsWithContent(dedupedRawItems, NEWS_ENRICH_LIMIT);
  const contentDedupedRawItems = dedupeByContentFingerprint(enrichedRawItems);
  const sortedContentDedupedRawItems = [...contentDedupedRawItems].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
  const qualityFilteredRawItems = filterLowQualityItems(sortedContentDedupedRawItems);
  const rankedQualityItems = rankItemsByQualityAndRecency(qualityFilteredRawItems);
  const nonEchoFallbackItems = sortedContentDedupedRawItems.filter(
    (item) =>
      legalRelevanceScore(item) >= LEGAL_RELEVANCE_MIN_SCORE &&
      !isFallbackSummary(item.summary) &&
      !isFallbackDetail(item.detailText ?? '') &&
      !(isTextEchoingTitle(item.summary, item.title) && isTextEchoingTitle(item.detailText ?? '', item.title)),
  );
  const rankedFallbackItems = rankItemsByQualityAndRecency(nonEchoFallbackItems);
  const richQualityItems = rankedQualityItems.filter((item) => contentRichnessScore(item) >= 4.4);
  const primaryItems = richQualityItems.length >= 18 ? richQualityItems : rankedQualityItems;
  const safeRawItems = primaryItems.length > 0
    ? primaryItems.slice(0, NEWS_CANDIDATE_POOL_LIMIT)
    : rankedFallbackItems.slice(0, NEWS_CANDIDATE_POOL_LIMIT);

  return {
    generatedAt: new Date().toISOString(),
    sourceHealth,
    rawItems: safeRawItems,
  };
}

async function getPreparedNewsSnapshot(forceRefresh = false) {
  const cached = forceRefresh ? null : getCachedPreparedNewsSnapshot();
  if (cached) {
    return cached;
  }

  if (!forceRefresh && preparedNewsSnapshotPromise) {
    return preparedNewsSnapshotPromise;
  }

  preparedNewsSnapshotPromise = buildPreparedNewsSnapshot()
    .then((snapshot) => {
      setCachedPreparedNewsSnapshot(snapshot);
      return snapshot;
    })
    .finally(() => {
      preparedNewsSnapshotPromise = null;
    });

  return preparedNewsSnapshotPromise;
}

export async function buildDashboardNewsPayload(options: { activeCases: DashboardCaseLite[]; limit?: number }): Promise<DashboardNewsPayload> {
  const limit = Math.min(Math.max(options.limit ?? 80, 10), 200);
  let snapshot = await getPreparedNewsSnapshot();
  if (snapshot.rawItems.length === 0) {
    snapshot = await getPreparedNewsSnapshot(true);
  }
  if (snapshot.rawItems.length === 0 && lastNonEmptyPreparedNewsSnapshot) {
    snapshot = lastNonEmptyPreparedNewsSnapshot;
  }

  const liveItems = snapshot.rawItems
    .map((rawItem) => mapRawToLiveItem(rawItem, options.activeCases))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, limit);

  return {
    generatedAt: snapshot.generatedAt,
    followupKeywords: [...DEFAULT_KEYWORD_FOLLOWUPS],
    items: liveItems,
    sources: snapshot.sourceHealth,
  };
}
