import { z } from 'zod';
import {
  buildJurisdictionDiff,
  getComparedFieldCount,
  jurisdictionDiffResponseSchema,
  jurisdictionRuleSetSchema,
} from '@/lib/litigation/jurisdiction';
import { createClient } from '@/utils/supabase/server';

const querySchema = z.object({
  leftCode: z.string().min(1),
  rightCode: z.string().min(1),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query = querySchema.safeParse({
      leftCode: url.searchParams.get('leftCode'),
      rightCode: url.searchParams.get('rightCode'),
    });

    if (!query.success) {
      return new Response('Geçersiz karşılaştırma parametreleri.', { status: 400 });
    }

    const { leftCode, rightCode } = query.data;

    if (leftCode === rightCode) {
      return new Response('İki farklı kural seti seçin.', { status: 400 });
    }

    const supabase = await createClient();

    const [leftResult, rightResult] = await Promise.all([
      supabase
        .from('jurisdiction_rule_sets')
        .select('code, name, version, config')
        .eq('code', leftCode)
        .limit(1)
        .maybeSingle(),
      supabase
        .from('jurisdiction_rule_sets')
        .select('code, name, version, config')
        .eq('code', rightCode)
        .limit(1)
        .maybeSingle(),
    ]);

    if (leftResult.error || rightResult.error) {
      return new Response('Karşılaştırma verisi alınamadı.', { status: 500 });
    }

    if (!leftResult.data || !rightResult.data) {
      return new Response('Seçilen kural setlerinden biri bulunamadı.', { status: 404 });
    }

    const left = jurisdictionRuleSetSchema.parse(leftResult.data);
    const right = jurisdictionRuleSetSchema.parse(rightResult.data);

    const differences = buildJurisdictionDiff(left.config, right.config).slice(0, 200);
    const comparedFieldCount = getComparedFieldCount(left.config, right.config);

    const payload = jurisdictionDiffResponseSchema.parse({
      left: {
        code: left.code,
        name: left.name,
        version: left.version,
      },
      right: {
        code: right.code,
        name: right.name,
        version: right.version,
      },
      comparedFieldCount,
      differenceCount: differences.length,
      differences,
    });

    return Response.json(payload);
  } catch {
    return new Response('Karşılaştırma servisi geçici olarak kullanılamıyor.', { status: 500 });
  }
}
