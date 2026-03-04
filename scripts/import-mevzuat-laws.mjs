import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { PDFParse } from "pdf-parse";
import dotenv from "dotenv";

function loadEnv() {
  const root = process.cwd();
  const candidates = [
    path.join(root, "backend", ".env"),
    path.join(root, ".env.local"),
    path.join(root, ".env"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: false });
    }
  }
}

function parseArgs(argv) {
  const out = {
    yearStart: 1920,
    yearEnd: new Date().getFullYear(),
    maxLaws: 0,
    stateFile: path.join(process.cwd(), "artifacts", "mevzuat-law-import-state.json"),
    backendUrl: process.env.RAG_BACKEND_URL || "http://127.0.0.1:8000",
    dryRun: false,
    includeOldVersions: false,
    pageSize: 200,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (token === "--include-old-versions") {
      out.includeOldVersions = true;
      continue;
    }
    const [k, v] = token.split("=");
    if (!v) continue;
    if (k === "--year-start") out.yearStart = Number(v);
    if (k === "--year-end") out.yearEnd = Number(v);
    if (k === "--max-laws") out.maxLaws = Number(v);
    if (k === "--state-file") out.stateFile = path.resolve(v);
    if (k === "--backend-url") out.backendUrl = v;
    if (k === "--page-size") out.pageSize = Number(v);
  }
  if (!Number.isFinite(out.yearStart) || !Number.isFinite(out.yearEnd)) {
    throw new Error("year-start/year-end must be numeric");
  }
  if (out.yearStart > out.yearEnd) {
    throw new Error("year-start must be <= year-end");
  }
  if (!Number.isFinite(out.maxLaws) || out.maxLaws < 0) {
    throw new Error("max-laws must be >= 0");
  }
  if (!Number.isFinite(out.pageSize) || out.pageSize < 10 || out.pageSize > 1000) {
    throw new Error("page-size must be between 10 and 1000");
  }
  return out;
}

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadState(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      imported: {},
      failed: {},
      manifest: null,
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object") {
      return { imported: {}, failed: {}, manifest: null };
    }
    return {
      imported: parsed.imported && typeof parsed.imported === "object" ? parsed.imported : {},
      failed: parsed.failed && typeof parsed.failed === "object" ? parsed.failed : {},
      manifest: parsed.manifest && typeof parsed.manifest === "object" ? parsed.manifest : null,
    };
  } catch {
    return {
      imported: {},
      failed: {},
      manifest: null,
    };
  }
}

function saveState(filePath, state) {
  ensureDirFor(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MOJIBAKE_HINT_RE = /[ÃÄÅÐÞ]/;

function scoreTurkishText(value) {
  let score = 0;
  const text = String(value || "");
  if (/[ğĞşŞıİçÇöÖüÜ]/.test(text)) score += 4;
  score -= (text.match(MOJIBAKE_HINT_RE) || []).length * 2;
  score -= (text.match(/�/g) || []).length * 3;
  return score;
}

function maybeFixMojibake(value) {
  const original = String(value || "");
  if (!original || !MOJIBAKE_HINT_RE.test(original)) return original;
  try {
    const fixed = Buffer.from(original, "latin1").toString("utf8");
    return scoreTurkishText(fixed) > scoreTurkishText(original) ? fixed : original;
  } catch {
    return original;
  }
}

function cleanWhitespace(value) {
  return maybeFixMojibake(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(input) {
  return String(input || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToText(html) {
  const noScript = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const noTags = noScript.replace(/<[^>]+>/g, " ");
  return cleanWhitespace(decodeHtmlEntities(noTags));
}

const MIN_LAW_TEXT_LENGTH = 200;

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url} => ${body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Invalid JSON ${url} => ${body.slice(0, 300)}`);
  }
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${url} => ${body.slice(0, 300)}`);
  }
  return res.text();
}

async function withRetries(label, fn, options = {}) {
  const attempts = Number.isFinite(options.attempts) ? Math.max(1, Number(options.attempts)) : 5;
  const baseDelayMs = Number.isFinite(options.baseDelayMs)
    ? Math.max(100, Number(options.baseDelayMs))
    : 800;
  const maxDelayMs = Number.isFinite(options.maxDelayMs)
    ? Math.max(baseDelayMs, Number(options.maxDelayMs))
    : 7000;

  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (i >= attempts) break;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (i - 1)) + Math.floor(Math.random() * 250);
      console.warn(
        `[import-mevzuat] retry ${i}/${attempts - 1} label=${label} wait=${delay}ms reason=${message.slice(0, 180)}`,
      );
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "Unknown retry error"));
}

function buildSupabaseHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

async function fetchSupabaseJson(url, serviceKey, options = {}) {
  return fetchJson(url, {
    headers: {
      ...buildSupabaseHeaders(serviceKey),
      ...(options.headers || {}),
    },
    method: options.method,
    body: options.body,
  });
}

async function findLawyerContext({ supabaseUrl, serviceKey }) {
  const q = new URLSearchParams({
    select: "id,bureau_id,role,created_at",
    role: "eq.lawyer",
    bureau_id: "not.is.null",
    order: "created_at.asc",
    limit: "1",
  });
  const url = `${supabaseUrl}/rest/v1/profiles?${q.toString()}`;
  const rows = await fetchJson(url, {
    headers: buildSupabaseHeaders(serviceKey),
  });
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No lawyer profile with bureau_id found in Supabase");
  }
  const row = rows[0];
  return {
    lawyerId: row.id,
    bureauId: row.bureau_id,
  };
}

async function ensureCorpusCase({ supabaseUrl, serviceKey, bureauId, lawyerId }) {
  const title = "Mevzuat Resmi Kanun Korpusu";
  const q = new URLSearchParams({
    select: "id,title,bureau_id,lawyer_id",
    bureau_id: `eq.${bureauId}`,
    title: `eq.${title}`,
    order: "created_at.asc",
    limit: "1",
  });
  const lookupUrl = `${supabaseUrl}/rest/v1/cases?${q.toString()}`;
  const existing = await fetchJson(lookupUrl, {
    headers: buildSupabaseHeaders(serviceKey),
  });
  if (Array.isArray(existing) && existing.length > 0) {
    return existing[0].id;
  }

  const insertUrl = `${supabaseUrl}/rest/v1/cases`;
  const payload = {
    title,
    status: "open",
    lawyer_id: lawyerId,
    bureau_id: bureauId,
    tags: ["system_corpus", "kanun", "mevzuat"],
    overview_notes: "Mevzuat gov tr kaynakli tek metin kanun korpusu",
  };
  const created = await fetchJson(`${insertUrl}?select=id`, {
    method: "POST",
    headers: {
      ...buildSupabaseHeaders(serviceKey),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!Array.isArray(created) || created.length === 0 || !created[0].id) {
    throw new Error("Failed to create corpus case");
  }
  return created[0].id;
}

function mevzuatDocKey(law) {
  return `${law.mevzuatTur}.${law.mevzuatTertip}.${law.mevzuatNo}`;
}

function sortLaws(a, b) {
  const na = Number(a.mevzuatNo) || 0;
  const nb = Number(b.mevzuatNo) || 0;
  if (na !== nb) return na - nb;
  const ta = Number(a.mevzuatTertip) || 0;
  const tb = Number(b.mevzuatTertip) || 0;
  return ta - tb;
}

function getFailedManifestYears(state) {
  return Object.keys(state?.failed || {})
    .filter((key) => key.startsWith("manifest.year."))
    .map((key) => Number(key.replace("manifest.year.", "")))
    .filter((year) => Number.isFinite(year));
}

function mevzuatCitation(law) {
  return `Mevzuat Kanun No ${law.mevzuatNo} | ${law.title}`;
}

function mevzuatOldCitation(law, oldLaw) {
  const tag = String(oldLaw.dateTag || oldLaw.kabulTarihDosyaPath || oldLaw.kabulTarih || "unknown")
    .replace(/[^\d]/g, "")
    .slice(0, 8);
  return `Mevzuat Kanun No ${law.mevzuatNo} | ${law.title} | ESKI_METIN_${tag || "unknown"}`;
}

async function findExistingDocumentByCitation({
  supabaseUrl,
  serviceKey,
  caseId,
  bureauId,
  citation,
}) {
  const q = new URLSearchParams({
    select: "id,citation,source_url",
    case_id: `eq.${caseId}`,
    bureau_id: `eq.${bureauId}`,
    citation: `eq.${citation}`,
    order: "created_at.desc",
    limit: "1",
  });
  const url = `${supabaseUrl}/rest/v1/documents?${q.toString()}`;
  const rows = await fetchSupabaseJson(url, serviceKey);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function upsertLawDirectToSupabase({
  supabaseUrl,
  serviceKey,
  caseId,
  bureauId,
  citation,
  rawText,
  sourceUrl,
}) {
  const existing = await findExistingDocumentByCitation({
    supabaseUrl,
    serviceKey,
    caseId,
    bureauId,
    citation,
  });
  if (existing?.id) {
    return {
      mode: "direct-existing",
      doc_id: existing.id,
      segments_created: 1,
      embedding_generated: false,
      enqueued_for_index: false,
    };
  }

  const insertUrl = `${supabaseUrl}/rest/v1/documents?select=id`;
  const payload = {
    case_id: caseId,
    bureau_id: bureauId,
    content: rawText,
    file_path: "",
    source_url: sourceUrl,
    citation,
    norm_hierarchy: "KANUN",
    version: 1,
    collected_at: new Date().toISOString(),
  };
  const created = await fetchSupabaseJson(insertUrl, serviceKey, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!Array.isArray(created) || created.length === 0 || !created[0].id) {
    throw new Error("Direct Supabase insert returned no id");
  }
  return {
    mode: "direct-insert",
    doc_id: created[0].id,
    segments_created: 1,
    embedding_generated: false,
    enqueued_for_index: false,
  };
}

async function fetchMevzuatYearPage({ year, start, length }) {
  const payload = {
    draw: 1,
    start,
    length,
    order: [],
    columns: [],
    search: { value: "", regex: false },
    parameters: {
      MevzuatTur: "Kanun",
      YonetmelikMevzuatTur: "OsmanliKanunu",
      AranacakIfade: "",
      AranacakYer: "1",
      MevzuatNo: "",
      BaslangicTarihi: String(year),
      BitisTarihi: String(year),
      TamCumle: false,
    },
  };
  return fetchJson("https://www.mevzuat.gov.tr/anasayfa/MevzuatDatatable", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify(payload),
  });
}

function normalizeMevzuatRow(row) {
  const mevzuatNo = String(row?.mevzuatNo || "").trim();
  const mevzuatTur = String(row?.mevzuatTur || "").trim();
  const mevzuatTertip = String(row?.mevzuatTertip || "").trim();
  if (!mevzuatNo || !mevzuatTur || !mevzuatTertip) return null;
  const urlPart = String(row?.url || "").trim();
  const detailUrl = urlPart
    ? urlPart.startsWith("http")
      ? urlPart
      : `https://www.mevzuat.gov.tr/${urlPart.replace(/^\//, "")}`
    : `https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=${encodeURIComponent(
        mevzuatNo,
      )}&MevzuatTur=${encodeURIComponent(mevzuatTur)}&MevzuatTertip=${encodeURIComponent(
        mevzuatTertip,
      )}`;
  return {
    mevzuatNo,
    mevzuatTur,
    mevzuatTertip,
    title: cleanWhitespace(String(row?.mevAdi || "")),
    detailUrl,
    resmiGazeteTarihi: cleanWhitespace(String(row?.resmiGazeteTarihi || "")),
    resmiGazeteSayisi: cleanWhitespace(String(row?.resmiGazeteSayisi || "")),
    kabulTarih: cleanWhitespace(String(row?.kabulTarih || "")),
    hasOldLaw: Boolean(row?.hasOldLaw),
    year: row?.resmiGazeteTarihiYil ? String(row.resmiGazeteTarihiYil) : "",
  };
}

async function getLawRowsForYear({ year, pageSize }) {
  const out = [];
  let start = 0;
  let total = null;
  let guard = 0;
  while (guard < 1000) {
    guard += 1;
    const page = await withRetries(
      `manifest-year=${year}-start=${start}`,
      () =>
        fetchMevzuatYearPage({
          year,
          start,
          length: pageSize,
        }),
      { attempts: 6, baseDelayMs: 900, maxDelayMs: 9000 },
    );
    const recordsTotal = Number(page?.recordsTotal || 0);
    if (!Number.isFinite(recordsTotal)) {
      throw new Error(`Invalid recordsTotal for year ${year}`);
    }
    if (total === null) total = recordsTotal;
    const rows = Array.isArray(page?.data) ? page.data : [];
    for (const row of rows) {
      const normalized = normalizeMevzuatRow(row);
      if (normalized) out.push(normalized);
    }
    start += rows.length;
    if (rows.length === 0 || start >= recordsTotal) break;
  }
  return out;
}

function buildIframeUrl(law) {
  return `https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=${encodeURIComponent(
    law.mevzuatTur,
  )}&MevzuatNo=${encodeURIComponent(law.mevzuatNo)}&MevzuatTertip=${encodeURIComponent(
    law.mevzuatTertip,
  )}`;
}

function buildPdfUrl(law) {
  return `https://www.mevzuat.gov.tr/MevzuatMetin/${law.mevzuatTur}.${law.mevzuatTertip}.${law.mevzuatNo}.pdf`;
}

function buildDocUrl(law) {
  return `https://www.mevzuat.gov.tr/MevzuatMetin/${law.mevzuatTur}.${law.mevzuatTertip}.${law.mevzuatNo}.doc`;
}

async function parsePdfText(url) {
  const parser = new PDFParse({ url });
  try {
    const result = await parser.getText();
    return cleanWhitespace(result?.text || "");
  } finally {
    await parser.destroy();
  }
}

async function fetchLawTextFromMevzuat(law) {
  const iframeUrl = buildIframeUrl(law);
  let iframeHtml = "";
  try {
    iframeHtml = await fetchText(iframeUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
  } catch {
    iframeHtml = "";
  }
  const iframeText = htmlToText(iframeHtml);
  if (iframeText && iframeText.length >= MIN_LAW_TEXT_LENGTH) {
    return {
      text: iframeText,
      sourceUrl: law.detailUrl,
      contentUrl: iframeUrl,
      mode: "iframe-html",
    };
  }

  const pdfUrl = buildPdfUrl(law);
  try {
    const pdfText = await parsePdfText(pdfUrl);
    if (pdfText && pdfText.length >= MIN_LAW_TEXT_LENGTH) {
      return {
        text: pdfText,
        sourceUrl: law.detailUrl,
        contentUrl: pdfUrl,
        mode: "pdf-fallback",
      };
    }
  } catch {
    // ignore and continue to next fallback
  }

  const docUrl = buildDocUrl(law);
  const docHtml = await fetchText(docUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const docText = htmlToText(docHtml);
  if (!docText || docText.length < MIN_LAW_TEXT_LENGTH) {
    throw new Error(`Kanun metni cok kisa (${docText.length})`);
  }
  return {
    text: docText,
    sourceUrl: law.detailUrl,
    contentUrl: docUrl,
    mode: "doc-fallback",
  };
}

async function fetchOldLaws(law) {
  if (!law.hasOldLaw) return [];
  const url = `https://www.mevzuat.gov.tr/EskiKanunlar/EskiKanunlarList?kanunSayisi=${encodeURIComponent(
    law.mevzuatNo,
  )}&mevzuatTertip=${encodeURIComponent(law.mevzuatTertip)}`;
  const rows = await fetchJson(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const dateTag = cleanWhitespace(String(row?.kabulTarihDosyaPath || row?.kabulTarih || ""));
      const pdfUrl = cleanWhitespace(String(row?.pdfUrl || ""));
      const docUrl = cleanWhitespace(String(row?.docUrl || ""));
      if (!dateTag || (!pdfUrl && !docUrl)) return null;
      return {
        dateTag: dateTag.replace(/[^\d]/g, "").slice(0, 8) || "unknown",
        kabulTarih: cleanWhitespace(String(row?.kabulTarih || "")),
        resmiGazeteTarihi: cleanWhitespace(String(row?.resmiGazeteTarihi || "")),
        resmiGazeteSayisi: cleanWhitespace(String(row?.resmiGazeteSayisi || "")),
        pdfUrl: pdfUrl || null,
        docUrl: docUrl || null,
      };
    })
    .filter(Boolean);
}

async function fetchOldLawText(oldLaw) {
  if (oldLaw.pdfUrl) {
    try {
      const text = await parsePdfText(oldLaw.pdfUrl);
      if (text && text.length >= MIN_LAW_TEXT_LENGTH) {
        return {
          text,
          sourceUrl: oldLaw.pdfUrl,
          mode: "old-pdf",
        };
      }
    } catch {
      // continue to doc fallback
    }
  }
  if (oldLaw.docUrl) {
    const docHtml = await fetchText(oldLaw.docUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const text = htmlToText(docHtml);
    if (text && text.length >= MIN_LAW_TEXT_LENGTH) {
      return {
        text,
        sourceUrl: oldLaw.docUrl,
        mode: "old-doc",
      };
    }
  }
  throw new Error("Eski metin parse edilemedi");
}

async function ingestLaw({
  backendUrl,
  bureauId,
  userId,
  caseId,
  citation,
  sourceUrl,
  rawText,
}) {
  const payload = {
    raw_text: rawText,
    source_url: sourceUrl,
    citation,
    norm_hierarchy: "KANUN",
    case_id: caseId,
    document_type: "FULL",
  };
  const res = await fetch(`${backendUrl}/api/v1/ingest/document`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bureau-ID": bureauId,
      "X-User-ID": userId,
    },
    body: JSON.stringify(payload),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new Error(
      `Ingest HTTP ${res.status}: ${
        typeof body?.detail === "string"
          ? body.detail
          : typeof body?.error === "string"
            ? body.error
            : JSON.stringify(body)
      }`,
    );
  }
  return body;
}

async function persistDocument({
  args,
  supabaseUrl,
  supabaseServiceKey,
  lawyer,
  caseId,
  citation,
  sourceUrl,
  rawText,
}) {
  if (args.dryRun) {
    return {
      mode: "dry-run",
      doc_id: null,
      segments_created: 1,
    };
  }
  try {
    const result = await ingestLaw({
      backendUrl: args.backendUrl,
      bureauId: lawyer.bureauId,
      userId: lawyer.lawyerId,
      caseId,
      citation,
      sourceUrl,
      rawText,
    });
    return { mode: "ingest", ...result };
  } catch (ingestErr) {
    const ingestMsg = ingestErr instanceof Error ? ingestErr.message : String(ingestErr);
    const isIngestUnavailable =
      ingestMsg.includes("Ingest HTTP 503") ||
      ingestMsg.toLowerCase().includes("pipeline unavailable");
    if (!isIngestUnavailable) throw ingestErr;
    return upsertLawDirectToSupabase({
      supabaseUrl,
      serviceKey: supabaseServiceKey,
      caseId,
      bureauId: lawyer.bureauId,
      citation,
      rawText,
      sourceUrl,
    });
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv);

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || "";
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
  }

  const lawyer = await findLawyerContext({
    supabaseUrl,
    serviceKey: supabaseServiceKey,
  });
  const caseId = process.env.CORPUS_CASE_ID
    ? String(process.env.CORPUS_CASE_ID).trim()
    : await ensureCorpusCase({
        supabaseUrl,
        serviceKey: supabaseServiceKey,
        bureauId: lawyer.bureauId,
        lawyerId: lawyer.lawyerId,
      });

  console.log(
    `[import-mevzuat] context bureau=${lawyer.bureauId} lawyer=${lawyer.lawyerId} case=${caseId}`,
  );
  console.log(
    `[import-mevzuat] years ${args.yearStart}-${args.yearEnd} | max-laws=${
      args.maxLaws || "ALL"
    } | include-old-versions=${args.includeOldVersions} | page-size=${args.pageSize} | dry-run=${args.dryRun}`,
  );

  const state = loadState(args.stateFile);
  const manifestKey = `${args.yearStart}-${args.yearEnd}|old=${args.includeOldVersions ? 1 : 0}|size=${args.pageSize}`;
  let unique = [];
  const hasManifest =
    state.manifest &&
    state.manifest.key === manifestKey &&
    Array.isArray(state.manifest.laws) &&
    state.manifest.laws.length > 0;

  if (hasManifest) {
    unique = state.manifest.laws;
    console.log(`[import-mevzuat] using cached manifest key=${manifestKey} count=${unique.length}`);
    const failedYears = getFailedManifestYears(state).filter(
      (year) => year >= args.yearStart && year <= args.yearEnd,
    );
    if (failedYears.length > 0) {
      console.log(
        `[import-mevzuat] retrying failed manifest years: ${failedYears.sort((a, b) => a - b).join(", ")}`,
      );
      const dedup = new Map(unique.map((row) => [mevzuatDocKey(row), row]));
      for (const year of failedYears) {
        try {
          const list = await getLawRowsForYear({ year, pageSize: args.pageSize });
          for (const row of list) dedup.set(mevzuatDocKey(row), row);
          delete state.failed[`manifest.year.${year}`];
          console.log(`[import-mevzuat] year=${year} retry success laws=${list.length}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          state.failed[`manifest.year.${year}`] = {
            error: message,
            at: new Date().toISOString(),
          };
          console.error(`[import-mevzuat] year=${year} retry failed: ${message}`);
        }
        await sleep(120);
      }
      unique = Array.from(dedup.values()).sort(sortLaws);
      state.manifest = {
        key: manifestKey,
        generatedAt: new Date().toISOString(),
        laws: unique,
      };
      saveState(args.stateFile, state);
    }
  } else {
    const rows = [];
    for (let year = args.yearStart; year <= args.yearEnd; year += 1) {
      try {
        const list = await getLawRowsForYear({ year, pageSize: args.pageSize });
        console.log(`[import-mevzuat] year=${year} laws=${list.length}`);
        rows.push(...list);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[import-mevzuat] year=${year} manifest FAILED: ${message}`);
        state.failed[`manifest.year.${year}`] = {
          error: message,
          at: new Date().toISOString(),
        };
        saveState(args.stateFile, state);
      }
      await sleep(120);
    }
    const dedup = new Map();
    for (const row of rows) {
      const key = mevzuatDocKey(row);
      if (!dedup.has(key)) dedup.set(key, row);
    }
    unique = Array.from(dedup.values()).sort(sortLaws);
    state.manifest = {
      key: manifestKey,
      generatedAt: new Date().toISOString(),
      laws: unique,
    };
    saveState(args.stateFile, state);
  }

  console.log(`[import-mevzuat] unique laws discovered=${unique.length}`);

  let importedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let attemptedCount = 0;
  let oldImportedCount = 0;
  const limit = args.maxLaws > 0 ? args.maxLaws : Number.POSITIVE_INFINITY;

  for (const law of unique) {
    if (attemptedCount >= limit) break;
    const lawKey = mevzuatDocKey(law);
    if (state.imported[lawKey]?.status === "ok") {
      skippedCount += 1;
      if (args.includeOldVersions && law.hasOldLaw) {
        const oldRows = await fetchOldLaws(law);
        for (const oldLaw of oldRows) {
          const oldKey = `${lawKey}.old.${oldLaw.dateTag}`;
          if (state.imported[oldKey]?.status === "ok") continue;
          try {
            const oldTextResult = await fetchOldLawText(oldLaw);
            const oldCitation = mevzuatOldCitation(law, oldLaw);
            const oldResult = await persistDocument({
              args,
              supabaseUrl,
              supabaseServiceKey,
              lawyer,
              caseId,
              citation: oldCitation,
              sourceUrl: oldTextResult.sourceUrl,
              rawText: oldTextResult.text.slice(0, 780_000),
            });
            state.imported[oldKey] = {
              status: "ok",
              lawNo: law.mevzuatNo,
              title: law.title,
              oldDateTag: oldLaw.dateTag,
              oldKabulTarih: oldLaw.kabulTarih,
              sourceUrl: oldTextResult.sourceUrl,
              mode: oldTextResult.mode,
              persistMode: oldResult?.mode || "ingest",
              docId: oldResult?.doc_id || null,
              at: new Date().toISOString(),
            };
            delete state.failed[oldKey];
            oldImportedCount += 1;
            saveState(args.stateFile, state);
            await sleep(120);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            state.failed[oldKey] = {
              detailUrl: law.detailUrl,
              error: message,
              at: new Date().toISOString(),
            };
            saveState(args.stateFile, state);
            await sleep(180);
          }
        }
      }
      continue;
    }

    attemptedCount += 1;
    console.log(
      `[import-mevzuat] -> key=${lawKey} | lawNo=${law.mevzuatNo} | ${law.title.slice(0, 90)}`,
    );
    try {
      const textResult = await fetchLawTextFromMevzuat(law);
      const text = textResult.text.slice(0, 780_000);
      const citation = mevzuatCitation(law);
      const persistResult = await persistDocument({
        args,
        supabaseUrl,
        supabaseServiceKey,
        lawyer,
        caseId,
        citation,
        sourceUrl: textResult.sourceUrl,
        rawText: text,
      });
      state.imported[lawKey] = {
        status: "ok",
        lawNo: law.mevzuatNo,
        mevzuatTur: law.mevzuatTur,
        mevzuatTertip: law.mevzuatTertip,
        title: law.title,
        detailUrl: law.detailUrl,
        contentUrl: textResult.contentUrl,
        resmiGazeteTarihi: law.resmiGazeteTarihi,
        resmiGazeteSayisi: law.resmiGazeteSayisi,
        hasOldLaw: law.hasOldLaw,
        mode: textResult.mode,
        persistMode: persistResult?.mode || "ingest",
        docId: persistResult?.doc_id || null,
        segmentsCreated: persistResult?.segments_created || 0,
        at: new Date().toISOString(),
      };
      delete state.failed[lawKey];
      importedCount += 1;
      saveState(args.stateFile, state);
      await sleep(200);

      if (args.includeOldVersions && law.hasOldLaw) {
        const oldRows = await fetchOldLaws(law);
        console.log(
          `[import-mevzuat]    old-versions lawNo=${law.mevzuatNo} count=${oldRows.length}`,
        );
        for (const oldLaw of oldRows) {
          const oldKey = `${lawKey}.old.${oldLaw.dateTag}`;
          if (state.imported[oldKey]?.status === "ok") continue;
          try {
            const oldTextResult = await fetchOldLawText(oldLaw);
            const oldCitation = mevzuatOldCitation(law, oldLaw);
            const oldResult = await persistDocument({
              args,
              supabaseUrl,
              supabaseServiceKey,
              lawyer,
              caseId,
              citation: oldCitation,
              sourceUrl: oldTextResult.sourceUrl,
              rawText: oldTextResult.text.slice(0, 780_000),
            });
            state.imported[oldKey] = {
              status: "ok",
              lawNo: law.mevzuatNo,
              title: law.title,
              oldDateTag: oldLaw.dateTag,
              oldKabulTarih: oldLaw.kabulTarih,
              sourceUrl: oldTextResult.sourceUrl,
              mode: oldTextResult.mode,
              persistMode: oldResult?.mode || "ingest",
              docId: oldResult?.doc_id || null,
              at: new Date().toISOString(),
            };
            delete state.failed[oldKey];
            oldImportedCount += 1;
            saveState(args.stateFile, state);
            await sleep(120);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            state.failed[oldKey] = {
              detailUrl: law.detailUrl,
              error: message,
              at: new Date().toISOString(),
            };
            saveState(args.stateFile, state);
            await sleep(180);
          }
        }
      }
    } catch (err) {
      failedCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[import-mevzuat] FAILED key=${lawKey}: ${message}`);
      state.failed[lawKey] = {
        detailUrl: law.detailUrl,
        error: message,
        at: new Date().toISOString(),
      };
      saveState(args.stateFile, state);
      await sleep(350);
    }
  }

  console.log(
    `[import-mevzuat] done imported=${importedCount} oldImported=${oldImportedCount} skipped=${skippedCount} failed=${failedCount} attempted=${attemptedCount} state=${args.stateFile}`,
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`[import-mevzuat] fatal: ${message}`);
  process.exit(1);
});
