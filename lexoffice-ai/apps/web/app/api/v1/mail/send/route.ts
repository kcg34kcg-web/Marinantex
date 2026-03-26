import { sendMailSchema } from "@lexoffice/contracts";
import { JOB_NAMES, PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getAttachmentQueue } from "@/lib/queue";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = sendMailSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.MAIL_SEND);

    const result = await services.mailThreadService.sendMessage(session.userId, payload);

    const scanJobs = result.attachmentScanJobs ?? [];
    if (scanJobs.length > 0) {
      const attachmentQueue = getAttachmentQueue();

      await Promise.all(
        scanJobs.map((job) =>
          attachmentQueue.add(JOB_NAMES.ATTACHMENT_VIRUS_SCAN, job, {
            jobId: `scan:${job.attachmentId}`,
            removeOnComplete: 50,
            removeOnFail: 100
          })
        )
      );
    }

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
