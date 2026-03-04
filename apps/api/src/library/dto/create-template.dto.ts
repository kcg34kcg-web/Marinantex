import { Type } from "class-transformer";
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import type { DocumentType } from "@prisma/client";
import { CanonicalTreeDto } from "./canonical-tree.dto";

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsEnum({
    PETITION: "PETITION",
    CONTRACT: "CONTRACT",
    NOTICE: "NOTICE",
    DEFENSE: "DEFENSE",
    INTERNAL_MEMO: "INTERNAL_MEMO",
  })
  documentType!: DocumentType;

  @Type(() => Number)
  @IsOptional()
  @Min(1)
  schemaVersion?: number;

  @ValidateNested()
  @Type(() => CanonicalTreeDto)
  canonicalJson!: CanonicalTreeDto;
}
