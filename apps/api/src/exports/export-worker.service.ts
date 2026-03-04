import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import { PDF_EXPORT_JOB_NAME, PDF_EXPORT_QUEUE_NAME } from "./export.constants";
import { ExportQueueService, type PdfExportJobPayload } from "./export-queue.service";
import { DocumentExportService } from "./document-export.service";

@Injectable()
export class ExportWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExportWorkerService.name);
  private worker: Worker<unknown, unknown, string> | null = null;

  constructor(
    private readonly queueService: ExportQueueService,
    private readonly documentExportService: DocumentExportService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      PDF_EXPORT_QUEUE_NAME,
      async (job: Job) => {
        if (job.name !== PDF_EXPORT_JOB_NAME) {
          return;
        }
        const payload = job.data as PdfExportJobPayload;
        await this.documentExportService.processQueuedExport(payload.exportId);
      },
      {
        connection: this.queueService.getConnection(),
        concurrency: 1,
      },
    );

    this.worker.on("failed", (job, error) => {
      const payload = job?.data as PdfExportJobPayload | undefined;
      this.logger.error(
        `EXPORT_JOB_FAILED exportId=${payload?.exportId ?? "unknown"}`,
        error,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}
