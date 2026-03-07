import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@lexoffice/db";
import { AuditService, JOB_NAMES, MailSyncService, QUEUES } from "@lexoffice/core";
import { mailSyncJobSchema } from "@lexoffice/contracts";

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

const auditService = new AuditService(prisma);
const mailSyncService = new MailSyncService(prisma, auditService);

const mailSyncWorker = new Worker(
  QUEUES.MAIL_SYNC,
  async (job) => {
    if (job.name === JOB_NAMES.MAIL_SYNC_RUN) {
      const payload = mailSyncJobSchema.parse(job.data);
      const result = await mailSyncService.runSyncJob(payload);

      await prisma.backgroundJob.updateMany({
        where: {
          correlationId: result.correlationId,
          queueName: QUEUES.MAIL_SYNC,
          status: {
            in: ["QUEUED", "RUNNING"]
          }
        },
        data: {
          status: "COMPLETED",
          result,
          finishedAt: new Date()
        }
      });

      return result;
    }

    throw new Error(`Desteklenmeyen job türü: ${job.name}`);
  },
  {
    connection: redis,
    concurrency: Number(process.env.BULLMQ_CONCURRENCY ?? 5)
  }
);

mailSyncWorker.on("completed", async (job) => {
  console.info(`Job completed: ${job.id}`);
});

mailSyncWorker.on("failed", async (job, error) => {
  console.error(`Job failed: ${job?.id}`, error);

  const correlationId =
    typeof job?.data?.correlationId === "string" ? job.data.correlationId : undefined;
  if (correlationId) {
    await prisma.backgroundJob.updateMany({
      where: {
        correlationId,
        queueName: QUEUES.MAIL_SYNC,
        status: {
          in: ["QUEUED", "RUNNING"]
        }
      },
      data: {
        status: "FAILED",
        error: error.message,
        finishedAt: new Date()
      }
    });
  }
});

async function shutdown(): Promise<void> {
  await mailSyncWorker.close();
  await redis.quit();
  await prisma.$disconnect();
}

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});
