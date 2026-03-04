import { IsEnum, IsOptional } from "class-validator";
import type { DocumentType } from "@prisma/client";

export class ListTemplateQueryDto {
  @IsOptional()
  @IsEnum({
    PETITION: "PETITION",
    CONTRACT: "CONTRACT",
    NOTICE: "NOTICE",
    DEFENSE: "DEFENSE",
    INTERNAL_MEMO: "INTERNAL_MEMO",
  })
  documentType?: DocumentType;
}
