import { createClient } from '@/utils/supabase/server';
import type { HybridSearchResult } from '@/lib/rag/types';

const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-large';

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

async function createQueryEmbedding(input: string): Promise<number[]> {
  const openAiKey = process.env.OPENAI_API_KEY;

  if (!openAiKey) {
    throw new Error('Missing environment variable: OPENAI_API_KEY');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: embeddingModel,
      input,
    }),
  });

  if (!response.ok) {
    throw new Error('Embedding request failed.');
  }

  const payload = (await response.json()) as EmbeddingResponse;
  const embedding = payload.data.at(0)?.embedding;

  if (!embedding) {
    throw new Error('Embedding response was empty.');
  }

  return embedding;
}

export async function hybridLegalSearch(params: {
  query: string;
  caseScope?: string;
  matchCount?: number;
}): Promise<HybridSearchResult[]> {
  const supabase = await createClient();
  const embedding = await createQueryEmbedding(params.query);

  const { data, error } = await supabase.rpc('hybrid_legal_search', {
    query_embedding: embedding,
    query_text: params.query,
    case_scope: params.caseScope ?? null,
    match_count: params.matchCount ?? 12,
  });

  if (error) {
    throw new Error('Hybrid search failed.');
  }

  return (data ?? []) as HybridSearchResult[];
}
