import { Type } from "class-transformer";
import { IsEnum, IsOptional, Min } from "class-validator";
import type { DocumentStatus, DocumentType } from "@prisma/client";

export class ListDocumentsQueryDto {
  @IsOptional()
  @IsEnum({
    DRAFT: "DRAFT",
    REVIEW: "REVIEW",
    FINAL: "FINAL",
    ARCHIVED: "ARCHIVED",
  })
  status?: DocumentStatus;

  @IsOptional()
  @IsEnum({
    PETITION: "PETITION",
    CONTRACT: "CONTRACT",
    NOTICE: "NOTICE",
    DEFENSE: "DEFENSE",
    INTERNAL_MEMO: "INTERNAL_MEMO",
  })
  type?: DocumentType;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  limit?: number;
}
