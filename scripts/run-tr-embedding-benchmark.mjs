/* eslint-disable no-console */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_DATASET = 'evals/tr_embedding_benchmark_set.jsonl';
const DEFAULT_MODELS = ['text-embedding-3-small', 'text-embedding-3-large'];
const DEFAULT_TOP_K = 5;
const DEFAULT_MRR_K = 10;

function parseArgs(argv) {
  const args = {
    dataset: DEFAULT_DATASET,
    output: 'artifacts/tr-embedding-benchmark-report.json',
    lockOutput: 'evals/embedding_model_lock.tr.json',
    models: [...DEFAULT_MODELS],
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY || '',
    topK: Number(process.env.TR_EMBED_BENCH_TOP_K || DEFAULT_TOP_K),
    mrrK: Number(process.env.TR_EMBED_BENCH_MRR_K || DEFAULT_MRR_K),
    batchSize: Number(process.env.TR_EMBED_BENCH_BATCH_SIZE || 64),
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (!arg.startsWith('--') || next === undefined || next.startsWith('--')) continue;
    i += 1;
    const key = arg.slice(2);
    if (key === 'dataset') args.dataset = next;
    if (key === 'output') args.output = next;
    if (key === 'lock-output') args.lockOutput = next;
    if (key === 'models') {
      args.models = next
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
    if (key === 'base-url') args.baseUrl = next;
    if (key === 'api-key') args.apiKey = next;
    if (key === 'top-k') args.topK = Number(next);
    if (key === 'mrr-k') args.mrrK = Number(next);
    if (key === 'batch-size') args.batchSize = Number(next);
  }

  if (!Number.isFinite(args.topK) || args.topK <= 0) args.topK = DEFAULT_TOP_K;
  if (!Number.isFinite(args.mrrK) || args.mrrK <= 0) args.mrrK = DEFAULT_MRR_K;
  if (!Number.isFinite(args.batchSize) || args.batchSize <= 0) args.batchSize = 64;
  if (args.models.length === 0) args.models = [...DEFAULT_MODELS];
  args.baseUrl = String(args.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return args;
}

async function readJsonl(filePath) {
  const absolute = path.resolve(filePath);
  const raw = await fs.readFile(absolute, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function validateDataset(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Benchmark dataset bos olamaz.');
  }

  for (const [index, row] of rows.entries()) {
    const line = index + 1;
    if (!row || typeof row !== 'object') {
      throw new Error(`Dataset row ${line} bir obje degil.`);
    }
    if (typeof row.query !== 'string' || row.query.trim().length === 0) {
      throw new Error(`Dataset row ${line}: query zorunlu.`);
    }
    if (!Array.isArray(row.positives) || row.positives.length === 0) {
      throw new Error(`Dataset row ${line}: positives en az bir eleman icermeli.`);
    }
  }
}

function l2Norm(vector) {
  let sum = 0;
  for (const value of vector) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  const denom = l2Norm(a) * l2Norm(b);
  if (denom <= 0) return 0;
  return dot / denom;
}

async function embedBatch({ baseUrl, apiKey, model, input }) {
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input }),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      (body && typeof body.error?.message === 'string' && body.error.message)
      || (body && typeof body.message === 'string' && body.message)
      || `HTTP ${response.status}`;
    throw new Error(`Embedding API failed for model=${model}: ${message}`);
  }

  const items = Array.isArray(body?.data) ? body.data : [];
  const vectors = items
    .sort((a, b) => Number(a.index) - Number(b.index))
    .map((item) => item.embedding);
  if (vectors.length !== input.length) {
    throw new Error(`Model ${model} returned ${vectors.length} vectors for ${input.length} texts.`);
  }
  return vectors;
}

async function embedTexts({ baseUrl, apiKey, model, texts, batchSize }) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchVectors = await embedBatch({
      baseUrl,
      apiKey,
      model,
      input: batch,
    });
    vectors.push(...batchVectors);
  }
  return vectors;
}

function evaluateModel({ rows, corpus, corpusVectors, queryVectors, topK, mrrK }) {
  const corpusMap = new Map();
  corpus.forEach((text, index) => {
    corpusMap.set(text, corpusVectors[index]);
  });

  let recallHits = 0;
  let reciprocalRankSum = 0;
  const perQuestion = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const queryVector = queryVectors[i];
    const scored = corpus.map((docText, docIndex) => ({
      docText,
      score: cosineSimilarity(queryVector, corpusVectors[docIndex]),
    }));
    scored.sort((a, b) => b.score - a.score);

    const positives = new Set(row.positives.map((item) => String(item)));
    const topKDocs = scored.slice(0, topK).map((item) => item.docText);
    const hasHit = topKDocs.some((doc) => positives.has(doc));
    if (hasHit) recallHits += 1;

    let rank = 0;
    for (let j = 0; j < Math.min(scored.length, mrrK); j += 1) {
      if (positives.has(scored[j].docText)) {
        rank = j + 1;
        break;
      }
    }
    if (rank > 0) reciprocalRankSum += 1 / rank;

    perQuestion.push({
      id: row.id || `q${i + 1}`,
      top_hit: topKDocs[0] || null,
      top_hit_score: Number((scored[0]?.score || 0).toFixed(6)),
      hit_at_k: hasHit,
      reciprocal_rank: rank > 0 ? Number((1 / rank).toFixed(6)) : 0,
    });
  }

  const recallAtK = rows.length > 0 ? recallHits / rows.length : 0;
  const mrrAtK = rows.length > 0 ? reciprocalRankSum / rows.length : 0;

  return {
    total_queries: rows.length,
    recall_at_k: Number(recallAtK.toFixed(6)),
    mrr_at_k: Number(mrrAtK.toFixed(6)),
    top_k: topK,
    mrr_k: mrrK,
    per_question: perQuestion,
    embedding_dimensions: Array.isArray(corpusVectors[0]) ? corpusVectors[0].length : 0,
    corpus_size: corpus.length,
    corpus_vector_count: corpusMap.size,
  };
}

function chooseWinner(results) {
  const sorted = [...results].sort((a, b) => {
    if (b.metrics.mrr_at_k !== a.metrics.mrr_at_k) {
      return b.metrics.mrr_at_k - a.metrics.mrr_at_k;
    }
    return b.metrics.recall_at_k - a.metrics.recall_at_k;
  });
  return sorted[0];
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.apiKey) {
    throw new Error('OPENAI_API_KEY gerekli. --api-key ile de verebilirsin.');
  }

  const rows = await readJsonl(args.dataset);
  validateDataset(rows);

  const corpus = Array.from(
    new Set(
      rows.flatMap((row) => [
        ...row.positives.map((item) => String(item)),
        ...(Array.isArray(row.negatives) ? row.negatives.map((item) => String(item)) : []),
      ]),
    ),
  );

  if (corpus.length === 0) {
    throw new Error('Benchmark corpus bos. positives/negatives kontrol et.');
  }

  const results = [];

  for (const model of args.models) {
    console.log(`Benchmarking model: ${model}`);
    const corpusVectors = await embedTexts({
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      model,
      texts: corpus,
      batchSize: args.batchSize,
    });
    const queryVectors = await embedTexts({
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      model,
      texts: rows.map((row) => String(row.query)),
      batchSize: args.batchSize,
    });

    const metrics = evaluateModel({
      rows,
      corpus,
      corpusVectors,
      queryVectors,
      topK: args.topK,
      mrrK: args.mrrK,
    });
    results.push({ model, metrics });
    console.log(
      `  recall@${args.topK}=${metrics.recall_at_k.toFixed(4)} mrr@${args.mrrK}=${metrics.mrr_at_k.toFixed(4)}`,
    );
  }

  const winner = chooseWinner(results);
  const report = {
    benchmark: 'tr_legal_embedding_benchmark_v1',
    language: 'tr',
    evaluated_at: new Date().toISOString(),
    dataset: path.resolve(args.dataset),
    base_url: args.baseUrl,
    selection_rule: 'highest_mrr_at_k_then_recall_at_k',
    top_k: args.topK,
    mrr_k: args.mrrK,
    results,
    winner_model: winner.model,
    winner_metrics: winner.metrics,
  };

  await ensureParentDir(args.output);
  await fs.writeFile(path.resolve(args.output), JSON.stringify(report, null, 2), 'utf8');

  const lockPayload = {
    benchmark: report.benchmark,
    language: report.language,
    locked_model: winner.model,
    evaluated_at: report.evaluated_at.slice(0, 10),
    selection_rule: report.selection_rule,
    metrics: {
      recall_at_k: winner.metrics.recall_at_k,
      mrr_at_k: winner.metrics.mrr_at_k,
      top_k: args.topK,
      mrr_k: args.mrrK,
    },
  };
  await ensureParentDir(args.lockOutput);
  await fs.writeFile(path.resolve(args.lockOutput), JSON.stringify(lockPayload, null, 2), 'utf8');

  console.log(`Winner: ${winner.model}`);
  console.log(`Report: ${path.resolve(args.output)}`);
  console.log(`Lock file: ${path.resolve(args.lockOutput)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
