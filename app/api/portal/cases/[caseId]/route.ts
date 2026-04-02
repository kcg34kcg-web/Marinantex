import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { extractRequestIp, writePortalAuditEvent } from '@/lib/portal/audit';
import { requirePortalClientAccess, resolvePortalCaseAccess } from '@/lib/portal/access';

interface Params {
  params: Promise<{ caseId: string }>;
}

const caseIdSchema = z.string().uuid();

export async function GET(request: Request, { params }: Params) {
  const access = await requirePortalClientAccess({ requireTwoFactor: true });
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  const { caseId } = await params;
  const parsedCaseId = caseIdSchema.safeParse(caseId);
  if (!parsedCaseId.success) {
    return Response.json({ error: 'Geçersiz caseId.' }, { status: 400 });
  }

  const context = access.context;
  const allowedCase = await resolvePortalCaseAccess({
    caseId: parsedCaseId.data,
    clientId: context.clientId,
    profileUserId: context.userId,
    bureauId: context.bureauId,
  });

  if (!allowedCase) {
    return Response.json({ error: 'Bu dosyayı görüntüleme yetkiniz yok.' }, { status: 403 });
  }

  const admin = createAdminClient();
  const [summaryResult, pendingActionsResult, notificationsResult] = await Promise.all([
    admin
      .from('ai_case_summaries')
      .select('id, summary_text, status, source_snapshot, last_generated_at, updated_at')
      .eq('case_id', parsedCaseId.data)
      .maybeSingle(),
    admin
      .from('office_tasks')
      .select('id, title, due_at, status, priority')
      .eq('case_id', parsedCaseId.data)
      .in('status', ['open', 'in_progress'])
      .order('due_at', { ascending: true })
      .limit(5),
    admin
      .from('notifications')
      .select('id, title, body, created_at, is_read')
      .eq('recipient_id', context.userId)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  await writePortalAuditEvent({
    tenantId: context.bureauId,
    actorUserId: context.userId,
    eventType: 'portal_case_viewed',
    objectType: 'case',
    objectId: parsedCaseId.data,
    ipAddress: extractRequestIp(request),
    userAgent: request.headers.get('user-agent'),
    result: 'success',
    metadata: {
      caseStatus: allowedCase.status,
      hasAiSummary: Boolean(summaryResult.data?.summary_text),
    },
  }).catch(() => undefined);

  return Response.json({
    case: {
      id: allowedCase.id,
      title: allowedCase.title,
      status: allowedCase.status,
      fileNo: allowedCase.file_no,
      updatedAt: allowedCase.updated_at,
    },
    summary:
      summaryResult.error || !summaryResult.data
        ? null
        : {
            id: summaryResult.data.id,
            status: summaryResult.data.status,
            text: summaryResult.data.summary_text,
            sourceSnapshot: summaryResult.data.source_snapshot ?? {},
            lastGeneratedAt: summaryResult.data.last_generated_at,
            updatedAt: summaryResult.data.updated_at,
          },
    pendingActions:
      pendingActionsResult.error?.code === '42P01' || Boolean(pendingActionsResult.error)
        ? []
        : (pendingActionsResult.data ?? []).map((item) => ({
            id: item.id,
            title: item.title,
            dueAt: item.due_at,
            status: item.status,
            priority: item.priority,
          })),
    recentNotifications:
      notificationsResult.error?.code === '42P01' || Boolean(notificationsResult.error)
        ? []
        : (notificationsResult.data ?? []).map((item) => ({
            id: item.id,
            title: item.title,
            body: item.body,
            createdAt: item.created_at,
            isRead: item.is_read,
          })),
  });
}
