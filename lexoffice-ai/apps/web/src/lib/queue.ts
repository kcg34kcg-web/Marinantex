import { Queue } from "bullmq";
import IORedis from "ioredis";
import { QUEUES } from "@lexoffice/core";

const globalForQueue = globalThis as unknown as {
  redis?: IORedis;
  mailSyncQueue?: Queue;
};

export function getMailSyncQueue(): Queue {
  if (!globalForQueue.redis) {
    globalForQueue.redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null
    });
  }

  if (!globalForQueue.mailSyncQueue) {
    globalForQueue.mailSyncQueue = new Queue(QUEUES.MAIL_SYNC, {
      connection: globalForQueue.redis
    });
  }

  return globalForQueue.mailSyncQueue;
}
