import fs from "node:fs";
import path from "node:path";
import process from "node:process";
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
    dryRun: false,
    bureauId: "",
    caseIds: [],
    maxDocs: 0,
    scanPageSize: 1000,
    updateBatchSize: 20,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    const [k, v] = token.split("=");
    if (!v) continue;
    if (k === "--bureau-id") out.bureauId = String(v).trim();
    if (k === "--case-id") out.caseIds.push(String(v).trim());
    if (k === "--case-ids") {
      out.caseIds.push(
        ...String(v)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      );
    }
    if (k === "--max-docs") out.maxDocs = Number(v);
    if (k === "--scan-page-size") out.scanPageSize = Number(v);
    if (k === "--update-batch-size") out.updateBatchSize = Number(v);
  }

  out.caseIds = Array.from(new Set(out.caseIds));

  if (!Number.isFinite(out.maxDocs) || out.maxDocs < 0) {
    throw new Error("--max-docs must be >= 0");
  }
  if (
    !Number.isFinite(out.scanPageSize) ||
    out.scanPageSize < 50 ||
    out.scanPageSize > 5000
  ) {
    throw new Error("--scan-page-size must be between 50 and 5000");
  }
  if (
    !Number.isFinite(out.updateBatchSize) ||
    out.updateBatchSize < 20 ||
    out.updateBatchSize > 500
  ) {
    throw new Error("--update-batch-size must be between 20 and 500");
  }

  return out;
}

function supabaseHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url} => ${text.slice(0, 300)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON ${url} => ${text.slice(0, 300)}`);
  }
}

async function resolveCorpusCases({ supabaseUrl, serviceKey, bureauId }) {
  const q = new URLSearchParams({
    select: "id,title,tags,bureau_id",
    tags: "cs.{system_corpus}",
    order: "created_at.asc",
    limit: "200",
  });
  if (bureauId) q.set("bureau_id", `eq.${bureauId}`);
  const url = `${supabaseUrl}/rest/v1/cases?${q.toString()}`;
  const rows = await fetchJson(url, { headers: supabaseHeaders(serviceKey) });
  return Array.isArray(rows) ? rows : [];
}

function isLikelyLawDocument(row) {
  const citation = String(row?.citation || "").trim().toLowerCase();
  const normHierarchy = String(row?.norm_hierarchy || "").trim().toUpperCase();
  const sourceUrl = String(row?.source_url || "").trim().toLowerCase();

  const byCitation =
    citation.startsWith("kanun no ") || citation.startsWith("mevzuat kanun no ");
  const byHierarchy = normHierarchy === "KANUN";
  const byOfficialDomain =
    sourceUrl.includes("mevzuat.gov.tr") ||
    sourceUrl.includes("tbmm.gov.tr") ||
    sourceUrl.includes("cdn.tbmm.gov.tr");

  return byCitation || byHierarchy || byOfficialDomain;
}

async function fetchCaseDocuments({
  supabaseUrl,
  serviceKey,
  caseId,
  pageSize,
  maxDocs,
}) {
  const rows = [];
  let offset = 0;
  const cap = maxDocs > 0 ? maxDocs : Number.POSITIVE_INFINITY;

  while (rows.length < cap) {
    const take = Math.min(pageSize, cap - rows.length);
    if (take <= 0) break;
    const q = new URLSearchParams({
      select: "id,citation,norm_hierarchy,bureau_id,case_id,source_url",
      case_id: `eq.${caseId}`,
      bureau_id: "not.is.null",
      order: "created_at.asc",
      limit: String(take),
      offset: String(offset),
    });
    const url = `${supabaseUrl}/rest/v1/documents?${q.toString()}`;
    const chunk = await fetchJson(url, { headers: supabaseHeaders(serviceKey) });
    const arr = Array.isArray(chunk) ? chunk : [];
    rows.push(...arr);
    if (arr.length < take) break;
    offset += arr.length;
  }
  return rows;
}

function isStatementTimeoutError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("statement timeout") ||
    text.includes('"code":"57014"') ||
    text.includes(" code 57014")
  );
}

async function patchDocumentsToPublic({
  supabaseUrl,
  serviceKey,
  ids,
}) {
  if (!ids.length) return 0;
  const queryIds = ids.join(",");
  const url = `${supabaseUrl}/rest/v1/documents?id=in.(${queryIds})`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(serviceKey),
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ bureau_id: null }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PATCH ${res.status} ${url} => ${body.slice(0, 300)}`);
  }
  return ids.length;
}

async function patchDocumentsToPublicSafe({
  supabaseUrl,
  serviceKey,
  ids,
}) {
  if (!ids.length) return 0;
  try {
    return await patchDocumentsToPublic({
      supabaseUrl,
      serviceKey,
      ids,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isStatementTimeoutError(msg) || ids.length <= 1) {
      throw err;
    }
    const mid = Math.floor(ids.length / 2);
    const left = ids.slice(0, mid);
    const right = ids.slice(mid);
    const leftUpdated = await patchDocumentsToPublicSafe({
      supabaseUrl,
      serviceKey,
      ids: left,
    });
    const rightUpdated = await patchDocumentsToPublicSafe({
      supabaseUrl,
      serviceKey,
      ids: right,
    });
    return leftUpdated + rightUpdated;
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv);

  const supabaseUrl = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceKey = (
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  ).trim();

  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
  }

  const corpusCases =
    args.caseIds.length > 0
      ? args.caseIds.map((id) => ({ id, title: "(manual)", tags: [], bureau_id: args.bureauId || null }))
      : await resolveCorpusCases({
          supabaseUrl,
          serviceKey,
          bureauId: args.bureauId || "",
        });

  if (!corpusCases.length) {
    console.log("[promote-public] No corpus case found.");
    return;
  }

  console.log(
    `[promote-public] dryRun=${args.dryRun} | cases=${corpusCases.length} | bureau=${
      args.bureauId || "ANY"
    }`,
  );

  let scanned = 0;
  let eligible = 0;
  let updated = 0;
  let skipped = 0;

  for (const c of corpusCases) {
    const caseId = String(c.id);
    const title = String(c.title || "");
    const docs = await fetchCaseDocuments({
      supabaseUrl,
      serviceKey,
      caseId,
      pageSize: args.scanPageSize,
      maxDocs: args.maxDocs,
    });
    scanned += docs.length;

    const eligibleRows = docs.filter(isLikelyLawDocument);
    const ineligibleRows = docs.length - eligibleRows.length;
    eligible += eligibleRows.length;
    skipped += ineligibleRows;

    console.log(
      `[promote-public] case=${caseId} title=${title.slice(0, 70)} scanned=${docs.length} eligible=${eligibleRows.length} skipped=${ineligibleRows}`,
    );

    if (args.dryRun || !eligibleRows.length) {
      continue;
    }

    const ids = eligibleRows.map((r) => String(r.id));
    for (let i = 0; i < ids.length; i += args.updateBatchSize) {
      const batch = ids.slice(i, i + args.updateBatchSize);
      updated += await patchDocumentsToPublicSafe({
        supabaseUrl,
        serviceKey,
        ids: batch,
      });
    }
  }

  console.log(
    `[promote-public] done scanned=${scanned} eligible=${eligible} updated=${updated} skipped=${skipped}`,
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`[promote-public] fatal: ${message}`);
  process.exit(1);
});
