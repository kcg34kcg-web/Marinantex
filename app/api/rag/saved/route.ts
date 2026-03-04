import { NextResponse } from 'next/server';
import { resolveBureauContext } from '@/app/api/rag/_lib/bureau-context';
import { createClient } from '@/utils/supabase/server';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    let context;
    try {
      context = await resolveBureauContext(supabase);
    } catch {
      return NextResponse.json({ error: 'Oturum bulunamadi.' }, { status: 401 });
    }

    const { bureauId, userId } = context;
    if (!bureauId) {
      return NextResponse.json({ error: 'Buro baglami bulunamadi.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get('limit') ?? '30');
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 30;

    const { data, error } = await supabase
      .from('saved_outputs')
      .select('id, title, content, output_type, output_kind, case_id, version_no, parent_output_id, is_final, created_at, metadata')
      .eq('bureau_id', bureauId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: 'Kayitli ciktilar okunamadi.' }, { status: 503 });
    }

    return NextResponse.json({ items: data ?? [] }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Kayitli cikti servisine ulasilamadi.' }, { status: 502 });
  }
}
