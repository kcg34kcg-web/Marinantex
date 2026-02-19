import { createHash } from 'node:crypto';
import { bundleExportManifestSchema } from '@/lib/litigation/graph';
import { buildMerkleRoot, computeChainHash } from '@/lib/litigation/merkle';
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

interface BatesRow {
  global_exhibit_id: string;
  presentation_bates_id: string | null;
  status: string;
}

interface PreviousChainRow {
  chain_hash: string;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function POST(_: Request, { params }: RouteParams) {
  try {
    const { id: caseId } = await params;
    const supabase = await createClient();

    const [nodesResult, linksResult, batesResult, previousChainResult] = await Promise.all([
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
      supabase
        .from('bates_registry')
        .select('global_exhibit_id, presentation_bates_id, status')
        .eq('case_id', caseId)
        .order('created_at', { ascending: true }),
      supabase
        .from('evidence_chain_logs')
        .select('chain_hash')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (nodesResult.error || linksResult.error || batesResult.error || previousChainResult.error) {
      return new Response('Bundle verisi hazırlanamadı.', { status: 500 });
    }

    const nodes = (nodesResult.data ?? []) as GraphNodeRow[];
    const links = (linksResult.data ?? []) as GraphLinkRow[];
    const bates = (batesResult.data ?? []) as BatesRow[];
    const previousHash = ((previousChainResult.data as PreviousChainRow | null)?.chain_hash ?? null) as string | null;

    const nodeLeaves = nodes.map((node) =>
      JSON.stringify({
        id: node.id,
        label: node.label,
        factualOccurrenceDate: node.factual_occurrence_date,
        epistemicDiscoveryDate: node.epistemic_discovery_date,
      }),
    );

    const linkLeaves = links.map((link) =>
      JSON.stringify({
        source: link.left_statement_id,
        target: link.right_statement_id,
        relation: link.nli_label ?? 'neutral',
        similarity: Number.isFinite(Number(link.semantic_similarity)) ? Number(link.semantic_similarity) : 0,
      }),
    );

    const batesLeaves = bates.map((item) =>
      JSON.stringify({
        globalExhibitId: item.global_exhibit_id,
        presentationBatesId: item.presentation_bates_id,
        status: item.status,
      }),
    );

    const leaves = [...nodeLeaves, ...linkLeaves, ...batesLeaves];
    const merkleRoot = buildMerkleRoot(leaves);

    const payloadCanonical = JSON.stringify({
      caseId,
      nodes: nodeLeaves,
      links: linkLeaves,
      bates: batesLeaves,
      merkleRoot,
    });

    const finalBundleSha256 = sha256(payloadCanonical);
    const createdAt = new Date().toISOString();

    const chainHash = computeChainHash({
      caseId,
      stage: 'bundle_export',
      payloadHash: finalBundleSha256,
      previousHash,
      timestampIso: createdAt,
    });

    const { error: chainInsertError } = await supabase.from('evidence_chain_logs').insert({
      case_id: caseId,
      stage: 'bundle_export',
      payload_hash: finalBundleSha256,
      previous_hash: previousHash,
      chain_hash: chainHash,
      merkle_root: merkleRoot,
    });

    if (chainInsertError) {
      return new Response('Chain kaydı oluşturulamadı.', { status: 500 });
    }

    const { error: bundleInsertError } = await supabase.from('bundle_exports').insert({
      case_id: caseId,
      final_bundle_sha256: finalBundleSha256,
    });

    if (bundleInsertError) {
      return new Response('Bundle kaydı oluşturulamadı.', { status: 500 });
    }

    const manifest = bundleExportManifestSchema.parse({
      caseId,
      finalBundleSha256,
      merkleRoot,
      chainHash,
      previousHash,
      createdAt,
      nodeCount: nodes.length,
      linkCount: links.length,
      batesCount: bates.length,
    });

    return Response.json(manifest);
  } catch {
    return new Response('Bundle export servisi geçici olarak kullanılamıyor.', { status: 500 });
  }
}
