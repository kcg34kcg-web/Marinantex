import { z } from 'zod';
import { graphNeighborhoodPayloadSchema, normalizeGraphRelation } from '@/lib/litigation/graph';
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

const querySchema = z.object({
  nodeId: z.string().min(1),
});

export async function GET(req: Request, { params }: RouteParams) {
  try {
    const { id: caseId } = await params;
    const url = new URL(req.url);
    const query = querySchema.safeParse({
      nodeId: url.searchParams.get('nodeId'),
    });

    if (!query.success) {
      return new Response('Geçersiz düğüm isteği.', { status: 400 });
    }

    const { nodeId } = query.data;
    const supabase = await createClient();

    const { data: linksData, error: linksError } = await supabase
      .from('contradiction_candidates')
      .select('left_statement_id, right_statement_id, nli_label, semantic_similarity')
      .eq('case_id', caseId)
      .or(`left_statement_id.eq.${nodeId},right_statement_id.eq.${nodeId}`)
      .order('created_at', { ascending: true })
      .limit(500);

    if (linksError) {
      return new Response('Komşuluk bağlantıları alınamadı.', { status: 500 });
    }

    const relatedNodeIds = new Set<string>([nodeId]);

    const links = ((linksData ?? []) as GraphLinkRow[]).map((link, index) => {
      relatedNodeIds.add(link.left_statement_id);
      relatedNodeIds.add(link.right_statement_id);

      return {
        id: `${link.left_statement_id}-${link.right_statement_id}-${index}`,
        source: link.left_statement_id,
        target: link.right_statement_id,
        relation: normalizeGraphRelation(link.nli_label),
        weight: Number.isFinite(Number(link.semantic_similarity)) ? Number(link.semantic_similarity) : 0,
      };
    });

    const { data: nodesData, error: nodesError } = await supabase
      .from('temporal_fact_nodes')
      .select('id, label, factual_occurrence_date, epistemic_discovery_date')
      .eq('case_id', caseId)
      .in('id', Array.from(relatedNodeIds));

    if (nodesError) {
      return new Response('Komşuluk düğümleri alınamadı.', { status: 500 });
    }

    const nodes = ((nodesData ?? []) as GraphNodeRow[]).map((node) => ({
      id: node.id,
      label: node.label,
      factualOccurrenceDate: node.factual_occurrence_date,
      epistemicDiscoveryDate: node.epistemic_discovery_date,
      x: 0,
      y: 0,
    }));

    const payload = graphNeighborhoodPayloadSchema.parse({
      centerNodeId: nodeId,
      nodes,
      links: links.filter(
        (link) => nodes.some((node) => node.id === link.source) && nodes.some((node) => node.id === link.target),
      ),
    });

    return Response.json(payload);
  } catch {
    return new Response('Komşuluk servisi geçici olarak kullanılamıyor.', { status: 500 });
  }
}
