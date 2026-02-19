import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';
import { graphPayloadSchema, normalizeGraphRelation } from '@/lib/litigation/graph';

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
  minSimilarity: z.coerce.number().min(0).max(1).default(0),
  maxEdges: z.coerce.number().int().positive().max(10000).default(3000),
});

export async function GET(req: Request, { params }: RouteParams) {
  try {
    const { id: caseId } = await params;
    const url = new URL(req.url);
    const parsedQuery = querySchema.safeParse({
      minSimilarity: url.searchParams.get('minSimilarity') ?? 0,
      maxEdges: url.searchParams.get('maxEdges') ?? 3000,
    });

    if (!parsedQuery.success) {
      return new Response('Geçersiz grafik filtreleri.', { status: 400 });
    }

    const { minSimilarity, maxEdges } = parsedQuery.data;
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

    const nodeIds = new Set(nodes.map((node) => node.id));

    const allLinks = ((linksData ?? []) as GraphLinkRow[])
      .filter((link) => nodeIds.has(link.left_statement_id) && nodeIds.has(link.right_statement_id))
      .map((link, index) => ({
        id: `${link.left_statement_id}-${link.right_statement_id}-${index}`,
        source: link.left_statement_id,
        target: link.right_statement_id,
        relation: normalizeGraphRelation(link.nli_label),
        weight: Number.isFinite(Number(link.semantic_similarity)) ? Number(link.semantic_similarity) : 0,
      }));

    const links = allLinks
      .filter((link) => link.weight >= minSimilarity)
      .sort((left, right) => right.weight - left.weight)
      .slice(0, maxEdges);

    const payload = graphPayloadSchema.parse({
      nodes,
      links,
      meta: {
        totalCandidates: allLinks.length,
        returnedLinks: links.length,
        minSimilarity,
        maxEdges,
      },
    });

    return Response.json(payload);
  } catch {
    return new Response('Graf servisi geçici olarak kullanılamıyor.', { status: 500 });
  }
}
