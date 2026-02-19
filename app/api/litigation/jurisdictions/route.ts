import { jurisdictionRuleSetListSchema } from '@/lib/litigation/jurisdiction';
import { createClient } from '@/utils/supabase/server';

interface RuleSetRow {
  code: string;
  name: string;
  version: string;
  config: Record<string, unknown>;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('jurisdiction_rule_sets')
      .select('code, name, version, config')
      .order('code', { ascending: true });

    if (error) {
      return new Response('Kural setleri alınamadı.', { status: 500 });
    }

    const payload = jurisdictionRuleSetListSchema.parse({
      items: ((data ?? []) as RuleSetRow[]).map((item) => ({
        code: item.code,
        name: item.name,
        version: item.version,
        config: item.config,
      })),
    });

    return Response.json(payload);
  } catch {
    return new Response('Kural seti servisi geçici olarak kullanılamıyor.', { status: 500 });
  }
}
