import { JOB_NAMES } from "@lexoffice/core";
import { mailboxWebhookProviderSchema } from "@lexoffice/contracts";
import { fail, ok } from "@/lib/http";
import { getMailSyncQueue } from "@/lib/queue";
import { services } from "@/lib/services";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ provider: string }>;
  }
) {
  try {
    const params = await context.params;
    const { provider } = mailboxWebhookProviderSchema.parse({
      provider: params.provider?.toUpperCase()
    });

    const rawBody = await request.text();
    const headers = Object.fromEntries(request.headers.entries());
    const result = await services.mailIntegrationService.ingestWebhook({
      provider,
      rawBody,
      headers
    });

    if (result.syncTargets.length > 0) {
      const queue = getMailSyncQueue();

      for (const target of result.syncTargets) {
        const jobPayload = await services.mailSyncService.triggerSync(undefined, {
          tenantId: target.tenantId,
          mailboxId: target.mailboxId,
          mode: "incremental"
        });

        await queue.add(JOB_NAMES.MAIL_SYNC_RUN, jobPayload, {
          jobId: `${jobPayload.tenantId}:${jobPayload.mailboxId}:${jobPayload.correlationId}`,
          attempts: 5,
          backoff: {
            type: "exponential",
            delay: 3_000
          },
          removeOnComplete: 200,
          removeOnFail: 500
        });
      }
    }

    return ok({
      received: true,
      provider,
      eventCount: result.eventCount,
      queuedSyncJobs: result.syncTargets.length
    });
  } catch (error) {
    return fail(error);
  }
}
