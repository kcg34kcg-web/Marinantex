import { createClient } from '@/utils/supabase/server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface GraphNodeRow {
  id: string;
  label: string;
  factual_occurrence_date: string | null;
  epistemic_discovery_date: string | null;
}

interface GraphLinkRow {
  left_statement_id: string;
  right_statement_id: string;
  nli_label: string | null;
  semantic_similarity: string;
}

export async function GET(_: Request, { params }: RouteParams) {
  try {
    const { id: caseId } = await params;
    const supabase = await createClient();

    const [{ data: nodesData, error: nodesError }, { data: linksData, error: linksError }] = await Promise.all([
      supabase
        .from('temporal_fact_nodes')
        .select('id, label, factual_occurrence_date, epistemic_discovery_date')
        .eq('case_id', caseId)
        .order('created_at', { ascending: true }),
      supabase
        .from('contradiction_candidates')
        .select('left_statement_id, right_statement_id, nli_label, semantic_similarity')
        .eq('case_id', caseId)
        .order('created_at', { ascending: true }),
    ]);

    if (nodesError || linksError) {
      return new Response('Graf verisi alınamadı.', { status: 500 });
    }

    const nodes = ((nodesData ?? []) as GraphNodeRow[]).map((node) => ({
      id: node.id,
      label: node.label,
      factualOccurrenceDate: node.factual_occurrence_date,
      epistemicDiscoveryDate: node.epistemic_discovery_date,
      x: 0,
      y: 0,
    }));

    const links = ((linksData ?? []) as GraphLinkRow[]).map((link, index) => ({
      id: `${link.left_statement_id}-${link.right_statement_id}-${index}`,
      source: link.left_statement_id,
      target: link.right_statement_id,
      relation: link.nli_label ?? 'neutral',
      weight: Number(link.semantic_similarity),
    }));

    return Response.json({
      nodes,
      links,
    });
  } catch {
    return new Response('Graf servisi geçici olarak kullanılamıyor.', { status: 500 });
  }
}
