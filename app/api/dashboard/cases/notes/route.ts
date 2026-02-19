import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';

const createCaseNoteSchema = z.object({
  caseId: z.string().uuid(),
  message: z.string().min(3).max(4000),
  isPublicToClient: z.boolean().default(false),
});

export async function GET(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const url = new URL(request.url);
  const caseId = url.searchParams.get('caseId');

  if (!caseId) {
    return Response.json({ error: 'caseId gereklidir.' }, { status: 400 });
  }

  const { data, error } = await access.supabase
    .from('case_updates')
    .select('id, message, is_public_to_client, created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(8);

  if (error) {
    return Response.json({ error: 'Not geçmişi alınamadı.' }, { status: 500 });
  }

  return Response.json({ notes: data ?? [] });
}

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = createCaseNoteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz not verisi.' }, { status: 400 });
  }

  const payload = parsed.data;

  const { data: caseRow } = await access.supabase
    .from('cases')
    .select('id')
    .eq('id', payload.caseId)
    .maybeSingle();

  if (!caseRow) {
    return Response.json({ error: 'Dosya bulunamadı.' }, { status: 404 });
  }

  const { data, error } = await access.supabase
    .from('case_updates')
    .insert({
      case_id: payload.caseId,
      message: payload.message,
      is_public_to_client: payload.isPublicToClient,
      created_by: access.userId,
      date: new Date().toISOString(),
    })
    .select('id, case_id, message, is_public_to_client, created_at')
    .single();

  if (error || !data) {
    return Response.json({ error: 'Not kaydı oluşturulamadı.' }, { status: 500 });
  }

  return Response.json({ note: data });
}
