import { Module } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import { DocumentLockService } from "./document-lock.service";
import { DocumentsService } from "./documents.service";

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentLockService],
})
export class DocumentsModule {}
