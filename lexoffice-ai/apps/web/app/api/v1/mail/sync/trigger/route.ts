import { JOB_NAMES, PERMISSIONS } from "@lexoffice/core";
import { triggerSyncSchema } from "@lexoffice/contracts";
import { fail, ok } from "@/lib/http";
import { getMailSyncQueue } from "@/lib/queue";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = triggerSyncSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.MAILBOX_CONNECT);

    const jobPayload = await services.mailSyncService.triggerSync(session.userId, payload);
    const mailSyncQueue = getMailSyncQueue();

    await mailSyncQueue.add(JOB_NAMES.MAIL_SYNC_RUN, jobPayload, {
      jobId: `${jobPayload.tenantId}:${jobPayload.mailboxId}:${jobPayload.correlationId}`,
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 3_000
      },
      removeOnComplete: 200,
      removeOnFail: 500
    });

    return ok({ queued: true, job: jobPayload });
  } catch (error) {
    return fail(error);
  }
}
