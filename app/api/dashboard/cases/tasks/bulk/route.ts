import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';

const createBulkCaseTaskSchema = z.object({
  caseIds: z.array(z.string().uuid()).min(1).max(100),
  title: z.string().min(3).max(180),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  dueAt: z.string().datetime().optional(),
  assignedTo: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const parsed = createBulkCaseTaskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: 'Geçersiz toplu görev verisi.' }, { status: 400 });
  }

  const payload = parsed.data;
  const admin = createAdminClient();

  const { data: cases, error: casesError } = await admin
    .from('cases')
    .select('id, title')
    .in('id', payload.caseIds);

  if (casesError) {
    return Response.json({ error: 'Dosya listesi doğrulanamadı.' }, { status: 500 });
  }

  if (!cases || cases.length === 0) {
    return Response.json({ error: 'Görev açılacak dosya bulunamadı.' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const inserts = cases.map((item) => ({
    case_id: item.id,
    source_message_id: null,
    thread_id: null,
    title: `${payload.title} · ${item.title}`,
    description: `Toplu görev - Dosya: ${item.title}`,
    priority: payload.priority,
    assigned_to: payload.assignedTo ?? access.userId,
    created_by: access.userId,
    due_at: payload.dueAt ?? null,
    status: 'open' as const,
    updated_at: now,
  }));

  const { error } = await admin.from('office_tasks').insert(inserts);

  if (error) {
    return Response.json({ error: 'Toplu görev oluşturulamadı.' }, { status: 500 });
  }

  return Response.json({ createdCount: inserts.length });
}
