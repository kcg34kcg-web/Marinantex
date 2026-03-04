import { Module } from "@nestjs/common";
import { DocxRendererService } from "./docx-renderer.service";
import { DocumentExportController } from "./document-export.controller";
import { DocumentExportService } from "./document-export.service";
import { ExportQueueService } from "./export-queue.service";
import { ExportWorkerService } from "./export-worker.service";
import { PdfRendererService } from "./pdf-renderer.service";
import { StorageService } from "./storage.service";

@Module({
  controllers: [DocumentExportController],
  providers: [
    DocumentExportService,
    ExportQueueService,
    ExportWorkerService,
    PdfRendererService,
    DocxRendererService,
    StorageService,
  ],
})
export class ExportsModule {}
