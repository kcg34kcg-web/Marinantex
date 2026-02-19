import { createClient } from '@/utils/supabase/server';
import type { LedgerEntry } from '@/types/finance';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('case_ledgers')
      .select('id, case_id, direction, type, category, amount, currency, transaction_date, created_at')
      .eq('case_id', id)
      .order('transaction_date', { ascending: false });

    if (error) {
      return new Response('Finans defteri getirilemedi.', { status: 500 });
    }

    const entries: LedgerEntry[] = (data ?? []).map((item) => ({
      id: item.id,
      caseId: item.case_id,
      direction: item.direction,
      type: item.type,
      category: item.category,
      amount: String(item.amount),
      currency: item.currency,
      transactionDate: item.transaction_date,
      createdAt: item.created_at,
    }));

    return Response.json({ entries });
  } catch {
    return new Response('Finans defteri servis hatası.', { status: 500 });
  }
}
