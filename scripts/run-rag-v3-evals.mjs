/* eslint-disable no-console */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const NO_ANSWER_SIGNALS = [
  'yeterli kanit yok',
  'bulunamadi',
  'yeterli bilgi yok',
  'insufficient evidence',
  'cannot find',
];

const ALLOWED_CATEGORIES = new Set([
  'answerable',
  'unanswerable',
  'celiskili',
  'zaman_hassas',
  'adversarial',
]);
const ALLOWED_REVIEW_STATUS = new Set(['expert_verified']);

function parseArgs(argv) {
  const args = {
    dataset: 'evals/rag_v3_ground_truth_v1.jsonl',
    baseUrl: process.env.RAG_V3_EVAL_BASE_URL || 'http://127.0.0.1:8000',
    queryPath: process.env.RAG_V3_EVAL_QUERY_PATH || '/api/v1/rag-v3/query',
    output: 'artifacts/rag-v3-eval-report.json',
    topK: Number(process.env.RAG_V3_EVAL_TOP_K || 10),
    dryRun: false,
    bureauId: process.env.RAG_V3_EVAL_BUREAU_ID || '',
    userId: process.env.RAG_V3_EVAL_USER_ID || '',
    concurrency: Number(process.env.RAG_V3_EVAL_CONCURRENCY || 2),
    minDatasetSize: Number(process.env.RAG_V3_EVAL_MIN_DATASET_SIZE || 100),
  };

  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) continue;
    i += 1;
    if (key === 'dataset') args.dataset = next;
    if (key === 'base-url') args.baseUrl = next;
    if (key === 'query-path') args.queryPath = next;
    if (key === 'output') args.output = next;
    if (key === 'top-k') args.topK = Number(next);
    if (key === 'bureau-id') args.bureauId = next;
    if (key === 'user-id') args.userId = next;
    if (key === 'concurrency') args.concurrency = Number(next);
    if (key === 'min-dataset-size') args.minDatasetSize = Number(next);
  }

  if (!Number.isFinite(args.topK) || args.topK < 1) args.topK = 10;
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) args.concurrency = 1;
  if (!Number.isFinite(args.minDatasetSize) || args.minDatasetSize < 1) args.minDatasetSize = 100;
  return args;
}

async function readJsonl(filePath) {
  const absolute = path.resolve(filePath);
  const raw = await fs.readFile(absolute, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  return lines.map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL at line ${idx + 1}: ${error.message}`);
    }
  });
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function validateRow(row, index) {
  const lineNo = index + 1;
  if (!row || typeof row !== 'object') {
    throw new Error(`Dataset row ${lineNo} is not an object.`);
  }
  if (typeof row.question !== 'string' || row.question.trim().length === 0) {
    throw new Error(`Dataset row ${lineNo} missing non-empty "question".`);
  }
  if (typeof row.question_id !== 'string' || row.question_id.trim().length === 0) {
    throw new Error(`Dataset row ${lineNo} missing non-empty "question_id".`);
  }
  if (typeof row.dataset_version !== 'string' || row.dataset_version.trim().length === 0) {
    throw new Error(`Dataset row ${lineNo} missing non-empty "dataset_version".`);
  }
  if (typeof row.gold_answer !== 'string' || row.gold_answer.trim().length === 0) {
    throw new Error(`Dataset row ${lineNo} missing non-empty "gold_answer".`);
  }
  const temporalFields = ['as_of_date', 'event_date', 'decision_date'];
  for (const field of temporalFields) {
    const value = row[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`Dataset row ${lineNo} ${field} must be YYYY-MM-DD string when provided.`);
    }
  }
  if (!Array.isArray(row.gold_citations)) {
    throw new Error(`Dataset row ${lineNo} missing array "gold_citations".`);
  }
  const category = String(row.category || '').toLowerCase().trim();
  if (!ALLOWED_CATEGORIES.has(category)) {
    throw new Error(
      `Dataset row ${lineNo} has invalid category "${row.category}". Allowed: ${Array.from(ALLOWED_CATEGORIES).join(', ')}.`,
    );
  }
  const rubric = row.rubric;
  if (!rubric || typeof rubric !== 'object') {
    throw new Error(`Dataset row ${lineNo} missing object "rubric".`);
  }
  const rubricKeys = ['dogruluk', 'kaynaklilik', 'no_answer', 'guvenlik'];
  for (const key of rubricKeys) {
    if (!isFiniteNumber(rubric[key])) {
      throw new Error(`Dataset row ${lineNo} rubric.${key} must be numeric.`);
    }
  }

  const review = row.review;
  if (!review || typeof review !== 'object') {
    throw new Error(`Dataset row ${lineNo} missing object "review".`);
  }
  if (typeof review.reviewer !== 'string' || review.reviewer.trim().length === 0) {
    throw new Error(`Dataset row ${lineNo} review.reviewer must be non-empty string.`);
  }
  if (typeof review.reviewed_at !== 'string' || Number.isNaN(Date.parse(review.reviewed_at))) {
    throw new Error(`Dataset row ${lineNo} review.reviewed_at must be valid ISO date.`);
  }
  const reviewStatus = String(review.status || '').toLowerCase().trim();
  if (!ALLOWED_REVIEW_STATUS.has(reviewStatus)) {
    throw new Error(
      `Dataset row ${lineNo} review.status must be one of: ${Array.from(ALLOWED_REVIEW_STATUS).join(', ')}.`,
    );
  }
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function isNoAnswerText(answer) {
  const lowered = String(answer || '').toLowerCase();
  return NO_ANSWER_SIGNALS.some((token) => lowered.includes(token));
}

function toCitationKey(citation) {
  const sourceId = String(citation?.source_id || citation?.sourceId || '').trim().toLowerCase();
  const articleNo = String(citation?.article_no || citation?.articleNo || '').trim().toLowerCase();
  const clauseNo = String(citation?.clause_no || citation?.clauseNo || '').trim().toLowerCase();
  const subclauseNo = String(citation?.subclause_no || citation?.subclauseNo || '').trim().toLowerCase();
  return `${sourceId}|${articleNo}|${clauseNo}|${subclauseNo}`;
}

function matchesGoldCitation(predictedSet, gold) {
  const sourceId = String(gold?.source_id || '').trim().toLowerCase();
  const articleNo = String(gold?.article_no || '').trim().toLowerCase();
  const clauseNo = String(gold?.clause_no || '').trim().toLowerCase();
  const subclauseNo = String(gold?.subclause_no || '').trim().toLowerCase();

  const exact = `${sourceId}|${articleNo}|${clauseNo}|${subclauseNo}`;
  if (predictedSet.has(exact)) return true;

  const relaxedArticle = `${sourceId}|${articleNo}||`;
  if (articleNo && predictedSet.has(relaxedArticle)) return true;

  const relaxedSource = `${sourceId}|||`;
  return sourceId ? predictedSet.has(relaxedSource) : false;
}

function extractFingerprint(payload) {
  const fp = payload?.fingerprint;
  const hasObject = fp && typeof fp === 'object';
  if (!hasObject) {
    return {
      present: false,
      missing: [
        'model_name',
        'model_version',
        'index_version',
        'prompt_version',
        'doc_hashes',
        'chunk_hashes',
      ],
      value: null,
    };
  }

  const required = [
    'model_name',
    'model_version',
    'index_version',
    'prompt_version',
    'doc_hashes',
    'chunk_hashes',
  ];
  const missing = [];
  for (const key of required) {
    const value = fp[key];
    if (key === 'doc_hashes' || key === 'chunk_hashes') {
      if (!Array.isArray(value)) missing.push(key);
      continue;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      missing.push(key);
    }
  }

  return {
    present: missing.length === 0,
    missing,
    value: fp,
  };
}

function classifyFailure({
  ok,
  expectedNoAnswer,
  predictedNoAnswer,
  goldCitationCount,
  matchedGoldCitations,
}) {
  if (!ok) return 'transport_or_contract_error';
  if (expectedNoAnswer && !predictedNoAnswer) return 'hallucination_or_policy_miss';
  if (!expectedNoAnswer && predictedNoAnswer) return 'retrieval_or_rerank_miss';
  if (goldCitationCount > 0 && matchedGoldCitations === 0) return 'citation_miss';
  if (goldCitationCount > 0 && matchedGoldCitations < goldCitationCount) return 'partial_citation';
  return 'pass';
}

async function callQuery({ baseUrl, queryPath, topK, headers }, row) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}${queryPath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: row.question,
      top_k: topK,
      jurisdiction: 'TR',
      acl_tags: ['public'],
      as_of_date: typeof row.as_of_date === 'string' ? row.as_of_date : undefined,
      event_date: typeof row.event_date === 'string' ? row.event_date : undefined,
      decision_date: typeof row.decision_date === 'string' ? row.decision_date : undefined,
    }),
  });
  const latencyMs = Date.now() - startedAt;

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return {
    ok: response.ok,
    statusCode: response.status,
    latencyMs,
    body,
  };
}

async function runConcurrent(rows, limit, worker) {
  const results = new Array(rows.length);
  let index = 0;

  async function runner() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= rows.length) return;
      results[current] = await worker(rows[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, rows.length) }, () => runner());
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  const rows = await readJsonl(args.dataset);
  rows.forEach((row, idx) => validateRow(row, idx));

  console.log(`RAG v3 eval: dataset=${args.dataset} size=${rows.length}`);

  if (args.dryRun) {
    console.log('Dry-run mode: no HTTP requests will be sent.');
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
  };
  if (args.bureauId) headers['X-Bureau-ID'] = args.bureauId;
  if (args.userId) headers['X-User-ID'] = args.userId;

  const results = await runConcurrent(rows, args.concurrency, async (row) => {
    const response = await callQuery(
      {
        baseUrl: args.baseUrl,
        queryPath: args.queryPath,
        topK: args.topK,
        headers,
      },
      row,
    );

    const answer = String(response.body?.answer || '');
    const status = String(response.body?.status || '');
    const citations = Array.isArray(response.body?.citations) ? response.body.citations : [];
    const fingerprint = extractFingerprint(response.body || {});
    const predictedNoAnswer = status === 'no_answer' || isNoAnswerText(answer);

    const goldCitations = Array.isArray(row.gold_citations) ? row.gold_citations : [];
    const predictedSet = new Set(citations.map((c) => toCitationKey(c)));
    const matchedGold = goldCitations.filter((gold) => matchesGoldCitation(predictedSet, gold)).length;

    const expectedNoAnswer =
      String(row.category || '').toLowerCase() === 'unanswerable'
      || Number(row?.rubric?.no_answer || 0) === 1;

    return {
      question_id: row.question_id,
      question: row.question,
      dataset_version: row.dataset_version,
      category: row.category,
      ok: response.ok,
      statusCode: response.statusCode,
      latencyMs: response.latencyMs,
      predictedNoAnswer,
      expectedNoAnswer,
      goldCitationCount: goldCitations.length,
      matchedGoldCitations: matchedGold,
      fingerprintPresent: fingerprint.present,
      fingerprintMissing: fingerprint.missing,
      fingerprint: fingerprint.value,
      answerPreview: answer.slice(0, 180),
      failure_class: classifyFailure({
        ok: response.ok,
        expectedNoAnswer,
        predictedNoAnswer,
        goldCitationCount: goldCitations.length,
        matchedGoldCitations: matchedGold,
      }),
    };
  });

  const latencies = results.map((r) => r.latencyMs);
  const datasetVersions = Array.from(new Set(rows.map((row) => String(row.dataset_version || '').trim()).filter(Boolean)));
  const reviewers = Array.from(new Set(rows.map((row) => String(row?.review?.reviewer || '').trim()).filter(Boolean)));
  const totalGoldCitationCount = results.reduce((sum, r) => sum + r.goldCitationCount, 0);
  const totalMatchedGoldCitations = results.reduce((sum, r) => sum + r.matchedGoldCitations, 0);

  const noAnswerRows = results.filter((r) => r.expectedNoAnswer);
  const noAnswerCorrect = noAnswerRows.filter((r) => r.predictedNoAnswer).length;

  const adversarialRows = results.filter((r) => String(r.category || '').toLowerCase() === 'adversarial');
  const adversarialSafe = adversarialRows.filter((r) => r.predictedNoAnswer).length;
  const fingerprintPresentCount = results.filter((r) => r.fingerprintPresent).length;

  const citationCoverage = totalGoldCitationCount > 0
    ? totalMatchedGoldCitations / totalGoldCitationCount
    : 0;
  const noAnswerAccuracy = noAnswerRows.length > 0
    ? noAnswerCorrect / noAnswerRows.length
    : 0;
  const adversarialSafeRate = adversarialRows.length > 0
    ? adversarialSafe / adversarialRows.length
    : 0;
  const fingerprintCoverage = results.length > 0
    ? fingerprintPresentCount / results.length
    : 0;
  const latencyP95 = percentile(latencies, 95);
  const datasetCoverageOk = rows.length >= args.minDatasetSize;
  const categoryBreakdown = Array.from(ALLOWED_CATEGORIES).reduce((acc, category) => {
    const group = results.filter((row) => String(row.category || '').toLowerCase() === category);
    const count = group.length;
    const success = group.filter((row) => row.ok).length;
    const noAnswerExpected = group.filter((row) => row.expectedNoAnswer).length;
    const noAnswerHit = group.filter((row) => row.expectedNoAnswer && row.predictedNoAnswer).length;
    acc[category] = {
      count,
      success_rate: count > 0 ? success / count : 0,
      no_answer_accuracy: noAnswerExpected > 0 ? noAnswerHit / noAnswerExpected : null,
      citation_coverage: (() => {
        const gold = group.reduce((sum, row) => sum + row.goldCitationCount, 0);
        const matched = group.reduce((sum, row) => sum + row.matchedGoldCitations, 0);
        return gold > 0 ? matched / gold : null;
      })(),
    };
    return acc;
  }, {});
  const failureClassCounts = results.reduce((acc, row) => {
    const key = String(row.failure_class || 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const summary = {
    generated_at: new Date().toISOString(),
    dataset: path.resolve(args.dataset),
    dataset_versions: datasetVersions,
    reviewers,
    request: {
      base_url: args.baseUrl,
      query_path: args.queryPath,
      top_k: args.topK,
      concurrency: args.concurrency,
      min_dataset_size: args.minDatasetSize,
    },
    totals: {
      questions: results.length,
      success_count: results.filter((r) => r.ok).length,
      error_count: results.filter((r) => !r.ok).length,
    },
    metrics: {
      citation_coverage: citationCoverage,
      no_answer_accuracy: noAnswerAccuracy,
      adversarial_safe_rate: adversarialSafeRate,
      fingerprint_coverage: fingerprintCoverage,
      latency_ms: {
        p50: percentile(latencies, 50),
        p95: latencyP95,
        max: latencies.length > 0 ? Math.max(...latencies) : 0,
      },
      category_breakdown: categoryBreakdown,
      failure_class_counts: failureClassCounts,
    },
    gates: {
      stage1: {
        citation_coverage_gt_80: citationCoverage > 0.8,
        no_answer_accuracy_gt_90: noAnswerAccuracy > 0.9,
        fingerprint_coverage_eq_100: fingerprintCoverage === 1,
        latency_p95_measured: latencyP95,
        dataset_coverage_sufficient: datasetCoverageOk,
      },
    },
    warnings: datasetCoverageOk ? [] : [
      `Dataset size ${rows.length} is below minimum ${args.minDatasetSize}; broad eval coverage not achieved.`,
    ],
    rows: results,
  };

  const outPath = path.resolve(args.output);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(`Eval report written: ${outPath}`);
  console.log(`Citation coverage: ${(summary.metrics.citation_coverage * 100).toFixed(1)}%`);
  console.log(`No-answer accuracy: ${(summary.metrics.no_answer_accuracy * 100).toFixed(1)}%`);
  console.log(`Adversarial safe rate: ${(summary.metrics.adversarial_safe_rate * 100).toFixed(1)}%`);
  console.log(`Fingerprint coverage: ${(summary.metrics.fingerprint_coverage * 100).toFixed(1)}%`);
  console.log(`Latency p95: ${summary.metrics.latency_ms.p95} ms`);
  if (!datasetCoverageOk) {
    console.log(`Dataset coverage warning: size=${rows.length}, min=${args.minDatasetSize}`);
  }
  console.log(`Stage-1 gate (citation>80/no-answer>90/fingerprint=100/dataset>=min): ${
    summary.gates.stage1.citation_coverage_gt_80
    && summary.gates.stage1.no_answer_accuracy_gt_90
    && summary.gates.stage1.fingerprint_coverage_eq_100
    && summary.gates.stage1.dataset_coverage_sufficient
      ? 'PASS'
      : 'FAIL'
  }`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
