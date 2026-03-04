import { IsEnum } from "class-validator";
import type { DocumentStatus } from "@prisma/client";

export class ChangeDocumentStatusDto {
  @IsEnum({
    DRAFT: "DRAFT",
    REVIEW: "REVIEW",
    FINAL: "FINAL",
    ARCHIVED: "ARCHIVED",
  })
  status!: DocumentStatus;
}
