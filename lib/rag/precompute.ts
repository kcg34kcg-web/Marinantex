import { hybridLegalSearch } from '@/lib/rag/hybrid-search';
import type { MustCiteCandidate } from '@/lib/rag/types';
import { createClient } from '@/utils/supabase/server';

function buildCaseTypePrompt(caseType: string): string {
  return `Türk hukukunda ${caseType} dosyası için mutlaka atıf yapılması gereken emsal kararlar ve anahtar ilkeler`;
}

export async function precomputeMustCites(caseId: string, caseType: string): Promise<MustCiteCandidate[]> {
  const searchResults = await hybridLegalSearch({
    query: buildCaseTypePrompt(caseType),
    matchCount: 5,
  });

  const selected = searchResults.map((item) => ({
    documentId: item.id,
    score: item.final_score,
  }));

  if (selected.length === 0) {
    return [];
  }

  const supabase = await createClient();

  const { error } = await supabase.from('case_must_cites').upsert(
    selected.map((item) => ({
      case_id: caseId,
      document_id: item.documentId,
      score: item.score,
    })),
    {
      onConflict: 'case_id,document_id',
    }
  );

  if (error) {
    throw new Error('Must-cite precompute failed.');
  }

  return selected;
}
