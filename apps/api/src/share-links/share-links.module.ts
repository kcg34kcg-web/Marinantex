import { Module } from "@nestjs/common";
import { DocumentShareLinksController } from "./document-share-links.controller";
import { PublicShareLinksController } from "./public-share-links.controller";
import { ShareLinksService } from "./share-links.service";

@Module({
  controllers: [DocumentShareLinksController, PublicShareLinksController],
  providers: [ShareLinksService],
})
export class ShareLinksModule {}
