import { Module } from "@nestjs/common";
import { ClauseController } from "./clause.controller";
import { ClauseService } from "./clause.service";
import { TemplateController } from "./template.controller";
import { TemplateService } from "./template.service";

@Module({
  controllers: [TemplateController, ClauseController],
  providers: [TemplateService, ClauseService],
})
export class LibraryModule {}
