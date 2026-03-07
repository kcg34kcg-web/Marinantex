import { z } from 'zod';
import { buildDashboardNewsPayload } from '@/lib/news/live-stream';

const querySchema = z.object({
  limit: z.coerce.number().int().min(10).max(200).default(80),
});

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      limit: url.searchParams.get('limit') ?? undefined,
    });

    if (!parsed.success) {
      return Response.json({ error: 'Gecersiz sorgu parametresi.' }, { status: 400 });
    }

    const payload = await buildDashboardNewsPayload({
      activeCases: [],
      limit: parsed.data.limit,
    });

    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Haber akisi olusturulamadi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
