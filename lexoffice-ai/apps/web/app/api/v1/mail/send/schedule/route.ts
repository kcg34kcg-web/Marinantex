import { scheduleSendMailSchema } from "@lexoffice/contracts";
import { JOB_NAMES, PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getMailDeliveryQueue } from "@/lib/queue";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = scheduleSendMailSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.MAIL_SEND);

    const scheduled = await services.mailThreadService.scheduleMessage(session.userId, payload);
    const mailDeliveryQueue = getMailDeliveryQueue();

    const delayMs = Math.max(0, scheduled.scheduledAt.getTime() - Date.now());

    await mailDeliveryQueue.add(JOB_NAMES.MAIL_SEND_SCHEDULED, scheduled.queuePayload, {
      jobId: scheduled.queueJobId,
      delay: delayMs,
      removeOnComplete: 50,
      removeOnFail: 100
    });

    return ok({
      scheduledDraftId: scheduled.scheduledDraftId,
      scheduledAt: scheduled.scheduledAt.toISOString(),
      correlationId: scheduled.correlationId
    });
  } catch (error) {
    return fail(error);
  }
}
