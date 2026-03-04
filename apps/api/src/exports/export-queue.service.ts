import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type { ConnectionOptions } from "bullmq";
import { Queue } from "bullmq";
import { PDF_EXPORT_JOB_NAME, PDF_EXPORT_QUEUE_NAME } from "./export.constants";

export interface PdfExportJobPayload {
  exportId: string;
}

@Injectable()
export class ExportQueueService implements OnModuleDestroy {
  private readonly connection: ConnectionOptions;
  private readonly queue: Queue<unknown, unknown, string>;

  constructor() {
    const redisUrl = process.env.REDIS_URL?.trim() || "redis://localhost:6379";
    this.connection = {
      url: redisUrl,
    };
    this.queue = new Queue(PDF_EXPORT_QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 2,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    });
  }

  getConnection(): ConnectionOptions {
    return this.connection;
  }

  async enqueuePdfExport(payload: PdfExportJobPayload) {
    return this.queue.add(PDF_EXPORT_JOB_NAME, payload, {
      jobId: payload.exportId,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
