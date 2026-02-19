import { auditChainContinuity, chainAuditResponseSchema } from '@/lib/litigation/chain-audit';
import { createClient } from '@/utils/supabase/server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ChainLogRow {
  stage: string;
  previous_hash: string | null;
  chain_hash: string;
  created_at: string;
}

export async function GET(_: Request, { params }: RouteParams) {
  try {
    const { id: caseId } = await params;
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('evidence_chain_logs')
      .select('stage, previous_hash, chain_hash, created_at')
      .eq('case_id', caseId)
      .order('created_at', { ascending: true });

    if (error) {
      return new Response('Chain kayıtları alınamadı.', { status: 500 });
    }

    const rows = (data ?? []) as ChainLogRow[];

    const { validLinkCount, issues } = auditChainContinuity(
      rows.map((row) => ({
        stage: row.stage,
        previousHash: row.previous_hash,
        chainHash: row.chain_hash,
        createdAt: row.created_at,
      })),
    );

    const payload = chainAuditResponseSchema.parse({
      caseId,
      totalLogs: rows.length,
      validLinkCount,
      brokenLinkCount: issues.length,
      isChainContinuous: issues.length === 0,
      issues,
    });

    return Response.json(payload);
  } catch {
    return new Response('Chain audit servisi geçici olarak kullanılamıyor.', { status: 500 });
  }
}
