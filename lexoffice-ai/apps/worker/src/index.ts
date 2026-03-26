import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@lexoffice/db";
import type { Prisma } from "@lexoffice/db";
import {
  AttachmentSecurityService,
  AuditService,
  JOB_NAMES,
  MailThreadService,
  MailSyncService,
  QUEUES
} from "@lexoffice/core";
import {
  attachmentVirusScanJobSchema,
  mailSyncJobSchema,
  scheduledMailSendJobSchema
} from "@lexoffice/contracts";

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

const auditService = new AuditService(prisma);
const mailSyncService = new MailSyncService(prisma, auditService);
const attachmentSecurityService = new AttachmentSecurityService(prisma, auditService);
const mailThreadService = new MailThreadService(prisma, auditService);
const attachmentQueue = new Queue(QUEUES.ATTACHMENTS, {
  connection: redis
});

const mailSyncWorker = new Worker(
  QUEUES.MAIL_SYNC,
  async (job) => {
    if (job.name === JOB_NAMES.MAIL_SYNC_RUN) {
      const payload = mailSyncJobSchema.parse(job.data);
      const result = await mailSyncService.runSyncJob(payload);

      await markJobsCompleted(QUEUES.MAIL_SYNC, result.correlationId, result);
      return result;
    }

    throw new Error(`Desteklenmeyen job türü: ${job.name}`);
  },
  {
    connection: redis,
    concurrency: Number(process.env.BULLMQ_CONCURRENCY ?? 5)
  }
);

const attachmentWorker = new Worker(
  QUEUES.ATTACHMENTS,
  async (job) => {
    if (job.name === JOB_NAMES.ATTACHMENT_VIRUS_SCAN) {
      const payload = attachmentVirusScanJobSchema.parse(job.data);
      const result = await attachmentSecurityService.runVirusScanJob(payload);

      await markJobsCompleted(QUEUES.ATTACHMENTS, result.correlationId, result);
      return result;
    }

    throw new Error(`Desteklenmeyen job türü: ${job.name}`);
  },
  {
    connection: redis,
    concurrency: Number(process.env.BULLMQ_CONCURRENCY ?? 5)
  }
);

const mailDeliveryWorker = new Worker(
  QUEUES.MAIL_DELIVERY,
  async (job) => {
    if (job.name === JOB_NAMES.MAIL_SEND_SCHEDULED) {
      const payload = scheduledMailSendJobSchema.parse(job.data);
      const result = await mailThreadService.processScheduledSendJob(payload);

      if (!result.skipped && result.attachmentScanJobs.length > 0) {
        await Promise.all(
          result.attachmentScanJobs.map((scanJob) =>
            attachmentQueue.add(JOB_NAMES.ATTACHMENT_VIRUS_SCAN, scanJob, {
              jobId: `scan:${scanJob.attachmentId}`,
              removeOnComplete: 50,
              removeOnFail: 100
            })
          )
        );
      }

      await markJobsCompleted(QUEUES.MAIL_DELIVERY, result.correlationId, result);
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
  console.info(`MailSync job completed: ${job.id}`);
});

attachmentWorker.on("completed", async (job) => {
  console.info(`Attachment job completed: ${job.id}`);
});

mailDeliveryWorker.on("completed", async (job) => {
  console.info(`MailDelivery job completed: ${job.id}`);
});

mailSyncWorker.on("failed", async (job, error) => {
  console.error(`MailSync job failed: ${job?.id}`, error);
  await markJobFailed(QUEUES.MAIL_SYNC, job?.data, error);
});

attachmentWorker.on("failed", async (job, error) => {
  console.error(`Attachment job failed: ${job?.id}`, error);
  await markJobFailed(QUEUES.ATTACHMENTS, job?.data, error);
});

mailDeliveryWorker.on("failed", async (job, error) => {
  console.error(`MailDelivery job failed: ${job?.id}`, error);
  await markJobFailed(QUEUES.MAIL_DELIVERY, job?.data, error);
});

async function markJobsCompleted(
  queueName: string,
  correlationId: string,
  result: unknown
): Promise<void> {
  await prisma.backgroundJob.updateMany({
    where: {
      correlationId,
      queueName,
      status: {
        in: ["QUEUED", "RUNNING", "FAILED"]
      }
    },
    data: {
      status: "COMPLETED",
      result: result as Prisma.InputJsonValue,
      finishedAt: new Date()
    }
  });
}

async function markJobFailed(
  queueName: string,
  jobData: unknown,
  error: Error
): Promise<void> {
  const correlationId =
    typeof jobData === "object" &&
    jobData !== null &&
    typeof (jobData as Record<string, unknown>).correlationId === "string"
      ? ((jobData as Record<string, unknown>).correlationId as string)
      : undefined;

  if (!correlationId) {
    return;
  }

  await prisma.backgroundJob.updateMany({
    where: {
      correlationId,
      queueName,
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

async function shutdown(): Promise<void> {
  await mailSyncWorker.close();
  await attachmentWorker.close();
  await mailDeliveryWorker.close();
  await attachmentQueue.close();
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
