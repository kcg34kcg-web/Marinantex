import { cancelScheduledSendSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getMailDeliveryQueue } from "@/lib/queue";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ scheduledDraftId: string }>;
  }
) {
  try {
    const session = await getServerSession();
    const params = await context.params;
    const payload = cancelScheduledSendSchema.parse({
      ...(await request.json()),
      scheduledDraftId: params.scheduledDraftId
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.MAIL_SEND);

    const result = await services.mailThreadService.cancelScheduledSend(session.userId, payload);
    const mailDeliveryQueue = getMailDeliveryQueue();
    const job = await mailDeliveryQueue.getJob(result.queueJobId);
    if (job) {
      await job.remove();
    }

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
