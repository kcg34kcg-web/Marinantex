import { Queue } from "bullmq";
import IORedis from "ioredis";
import { QUEUES } from "@lexoffice/core";

const globalForQueue = globalThis as unknown as {
  redis?: IORedis;
  mailSyncQueue?: Queue;
  mailDeliveryQueue?: Queue;
  attachmentQueue?: Queue;
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

export function getAttachmentQueue(): Queue {
  if (!globalForQueue.redis) {
    globalForQueue.redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null
    });
  }

  if (!globalForQueue.attachmentQueue) {
    globalForQueue.attachmentQueue = new Queue(QUEUES.ATTACHMENTS, {
      connection: globalForQueue.redis
    });
  }

  return globalForQueue.attachmentQueue;
}

export function getMailDeliveryQueue(): Queue {
  if (!globalForQueue.redis) {
    globalForQueue.redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null
    });
  }

  if (!globalForQueue.mailDeliveryQueue) {
    globalForQueue.mailDeliveryQueue = new Queue(QUEUES.MAIL_DELIVERY, {
      connection: globalForQueue.redis
    });
  }

  return globalForQueue.mailDeliveryQueue;
}
