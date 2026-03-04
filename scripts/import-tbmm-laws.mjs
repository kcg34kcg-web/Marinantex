import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
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
    yearStart: 2016,
    yearEnd: new Date().getFullYear(),
    maxLaws: 0,
    stateFile: path.join(process.cwd(), "artifacts", "tbmm-law-import-state.json"),
    backendUrl: process.env.RAG_BACKEND_URL || "http://127.0.0.1:8000",
    dryRun: false,
    headful: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (token === "--headful") {
      out.headful = true;
      continue;
    }
    const [k, v] = token.split("=");
    if (!v) continue;
    if (k === "--year-start") out.yearStart = Number(v);
    if (k === "--year-end") out.yearEnd = Number(v);
    if (k === "--max-laws") out.maxLaws = Number(v);
    if (k === "--state-file") out.stateFile = path.resolve(v);
    if (k === "--backend-url") out.backendUrl = v;
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

function cleanWhitespace(value) {
  return String(value || "")
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

function buildYearUrl(year) {
  const start = encodeURIComponent(`01/01/${year}`);
  const end = encodeURIComponent(`31/12/${year}`);
  return `https://www.tbmm.gov.tr/Yasama/Kanun-Sorgu-Sonuc?KanunKabuluBaslangicTarihi=${start}&KanunKabuluBitisTarihi=${end}`;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${url} => ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${url} => ${body.slice(0, 300)}`);
  }
  return res.text();
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
  const title = "TBMM Resmi Kanun Korpusu";
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
    tags: ["system_corpus", "kanun"],
    overview_notes: "TBMM kaynakli kanun korpusu",
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
  law,
  rawText,
  sourceUrl,
}) {
  const citation = `Kanun No ${law.lawNo} | ${law.title}`;
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
    source_url: sourceUrl || law.detailUrl,
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

async function getLawRowsForYear(page, year) {
  const url = buildYearUrl(year);
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(3500);

  const lengthSelect = page.locator("#dataTable_length select");
  if ((await lengthSelect.count()) > 0) {
    const options = await lengthSelect.locator("option").allTextContents();
    const has1000 = options.some((opt) => opt.includes("1000"));
    if (has1000) {
      await lengthSelect.selectOption("1000");
      await page.waitForTimeout(1800);
    }
  }

  const out = [];
  let guard = 0;
  while (guard < 500) {
    guard += 1;
    await page.waitForTimeout(600);
    const rows = await page.$$eval("#dataTable tbody tr", (trs) => {
      return trs.map((tr) => {
        const tds = Array.from(tr.querySelectorAll("td"));
        if (tds.length < 3) return null;
        const noCell = tds[0];
        const anchor = noCell.querySelector("a");
        const lawNo = (noCell.textContent || "").trim();
        const acceptanceDate = (tds[1].textContent || "").trim();
        const title = (tds[2].textContent || "").trim();
        return {
          lawNo,
          acceptanceDate,
          title,
          detailPath: anchor ? anchor.getAttribute("href") || "" : "",
        };
      }).filter(Boolean);
    });

    const meaningfulRows = rows.filter((row) => {
      const lawNo = cleanWhitespace(row.lawNo || "");
      const title = cleanWhitespace(row.title || "");
      return lawNo && !lawNo.toLowerCase().includes("tabloda herhangi bir veri");
    });
    out.push(...meaningfulRows);

    const next = page.locator("#dataTable_next");
    if ((await next.count()) === 0) break;
    const isDisabled = await next.evaluate((el) => el.classList.contains("disabled"));
    if (isDisabled) break;
    await next.locator("a").click();
    await page.waitForTimeout(1200);
  }

  const dedup = new Map();
  for (const row of out) {
    const key = `${row.lawNo}::${row.detailPath}`;
    if (!dedup.has(key)) dedup.set(key, row);
  }
  return Array.from(dedup.values()).map((row) => ({
    lawNo: cleanWhitespace(row.lawNo),
    acceptanceDate: cleanWhitespace(row.acceptanceDate),
    title: cleanWhitespace(row.title),
    detailUrl: row.detailPath.startsWith("http")
      ? row.detailPath
      : `https://www.tbmm.gov.tr${row.detailPath}`,
  }));
}

function extractKanunMetniUrl(detailHtml) {
  const html = String(detailHtml || "");
  const direct = [
    ...html.matchAll(
      /https:\/\/cdn\.tbmm\.gov\.tr\/KKBSPublicFile\/[^"'\s]+\/KanunMetni\/[^"'\s]+\.(?:html?|pdf)/gi,
    ),
  ];
  if (direct.length > 0) return decodeHtmlEntities(direct[0][0]);

  const hrefMatches = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)];
  for (const match of hrefMatches) {
    const href = decodeHtmlEntities(match[1] || "").trim();
    if (!href) continue;
    if (!/kanunmetni/i.test(href)) continue;
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith("//")) return `https:${href}`;
    if (href.startsWith("/")) return `https://www.tbmm.gov.tr${href}`;
  }
  return null;
}

async function fetchLawTextFromDetail(detailUrl) {
  const detailHtml = await fetchText(detailUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const fallbackText = htmlToText(detailHtml);
  const kanunMetniUrl = extractKanunMetniUrl(detailHtml);
  if (!kanunMetniUrl) {
    if (!fallbackText || fallbackText.length < MIN_LAW_TEXT_LENGTH) {
      throw new Error("Kanun metni linki bulunamadi");
    }
    return {
      text: fallbackText,
      kanunMetniUrl: detailUrl,
      usedDetailFallback: true,
    };
  }
  let text = "";
  try {
    if (/\.pdf(?:$|\?)/i.test(kanunMetniUrl)) {
      const parser = new PDFParse({ url: kanunMetniUrl });
      try {
        const result = await parser.getText();
        text = cleanWhitespace(result?.text || "");
      } finally {
        await parser.destroy();
      }
    } else {
      const kanunHtml = await fetchText(kanunMetniUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      text = htmlToText(kanunHtml);
    }
  } catch (err) {
    if (fallbackText && fallbackText.length >= MIN_LAW_TEXT_LENGTH) {
      return {
        text: fallbackText,
        kanunMetniUrl: detailUrl,
        usedDetailFallback: true,
      };
    }
    throw err;
  }
  if (!text || text.length < MIN_LAW_TEXT_LENGTH) {
    throw new Error(`Kanun metni cok kisa (${text.length})`);
  }
  return {
    text,
    kanunMetniUrl,
    usedDetailFallback: false,
  };
}

async function ingestLaw({
  backendUrl,
  bureauId,
  userId,
  caseId,
  law,
  rawText,
  sourceUrl,
}) {
  const payload = {
    raw_text: rawText,
    source_url: sourceUrl || law.detailUrl,
    citation: `Kanun No ${law.lawNo} | ${law.title}`,
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
    `[import] context bureau=${lawyer.bureauId} lawyer=${lawyer.lawyerId} case=${caseId}`,
  );
  console.log(
    `[import] years ${args.yearStart}-${args.yearEnd} | max-laws=${
      args.maxLaws || "ALL"
    } | backend=${args.backendUrl} | dry-run=${args.dryRun}`,
  );

  const state = loadState(args.stateFile);
  const browser = await chromium.launch({ headless: !args.headful });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  const manifestKey = `${args.yearStart}-${args.yearEnd}`;
  let unique = [];
  const hasManifest =
    state.manifest &&
    state.manifest.key === manifestKey &&
    Array.isArray(state.manifest.laws) &&
    state.manifest.laws.length > 0;

  if (hasManifest) {
    unique = state.manifest.laws;
    console.log(`[import] using cached manifest key=${manifestKey} count=${unique.length}`);
  } else {
    const laws = [];
    for (let year = args.yearStart; year <= args.yearEnd; year += 1) {
      const list = await getLawRowsForYear(page, year);
      console.log(`[import] year=${year} laws=${list.length}`);
      for (const row of list) {
        const lawNoDigits = String(row.lawNo || "").replace(/\D+/g, "");
        if (!lawNoDigits) continue;
        laws.push({
          ...row,
          lawNo: lawNoDigits,
        });
      }
    }

    const dedupByLawNo = new Map();
    for (const law of laws) {
      if (!dedupByLawNo.has(law.lawNo)) dedupByLawNo.set(law.lawNo, law);
    }
    unique = Array.from(dedupByLawNo.values()).sort((a, b) =>
      Number(a.lawNo) - Number(b.lawNo),
    );

    state.manifest = {
      key: manifestKey,
      generatedAt: new Date().toISOString(),
      laws: unique,
    };
    saveState(args.stateFile, state);
  }

  await browser.close();
  console.log(`[import] unique laws discovered=${unique.length}`);

  let importedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let attemptedCount = 0;
  const limit = args.maxLaws > 0 ? args.maxLaws : Number.POSITIVE_INFINITY;

  for (const law of unique) {
    if (attemptedCount >= limit) break;
    if (state.imported[law.lawNo]?.status === "ok") {
      skippedCount += 1;
      continue;
    }
    attemptedCount += 1;
    console.log(`[import] -> law=${law.lawNo} | ${law.title.slice(0, 90)}`);
    try {
      const detail = await fetchLawTextFromDetail(law.detailUrl);
      const text = detail.text.slice(0, 780_000);
      if (args.dryRun) {
        state.imported[law.lawNo] = {
          status: "ok",
          dryRun: true,
          textLen: text.length,
          detailUrl: law.detailUrl,
          at: new Date().toISOString(),
        };
      } else {
        let result = null;
        try {
          result = await ingestLaw({
            backendUrl: args.backendUrl,
            bureauId: lawyer.bureauId,
            userId: lawyer.lawyerId,
            caseId,
            law,
            rawText: text,
            sourceUrl: detail.kanunMetniUrl || law.detailUrl,
          });
        } catch (ingestErr) {
          const ingestMsg = ingestErr instanceof Error ? ingestErr.message : String(ingestErr);
          const isIngestUnavailable =
            ingestMsg.includes("Ingest HTTP 503") ||
            ingestMsg.toLowerCase().includes("pipeline unavailable");
          if (!isIngestUnavailable) throw ingestErr;
          console.warn(
            `[import] ingest unavailable for law=${law.lawNo}; falling back to direct Supabase insert`,
          );
          result = await upsertLawDirectToSupabase({
            supabaseUrl,
            serviceKey: supabaseServiceKey,
            caseId,
            bureauId: lawyer.bureauId,
            law,
            rawText: text,
            sourceUrl: detail.kanunMetniUrl || law.detailUrl,
          });
        }
        state.imported[law.lawNo] = {
          status: "ok",
          detailUrl: law.detailUrl,
          kanunMetniUrl: detail.kanunMetniUrl,
          docId: result?.doc_id || null,
          segmentsCreated: result?.segments_created || 0,
          persistMode: result?.mode || "ingest",
          at: new Date().toISOString(),
        };
      }
      delete state.failed[law.lawNo];
      importedCount += 1;
      saveState(args.stateFile, state);
      await sleep(400);
    } catch (err) {
      failedCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[import] FAILED law=${law.lawNo}: ${message}`);
      state.failed[law.lawNo] = {
        detailUrl: law.detailUrl,
        error: message,
        at: new Date().toISOString(),
      };
      saveState(args.stateFile, state);
      await sleep(800);
    }
  }

  console.log(
    `[import] done imported=${importedCount} skipped=${skippedCount} failed=${failedCount} attempted=${attemptedCount} state=${args.stateFile}`,
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`[import] fatal: ${message}`);
  process.exit(1);
});
