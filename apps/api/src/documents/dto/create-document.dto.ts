import { Type } from "class-transformer";
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import type { DocumentType } from "@prisma/client";

class CanonicalTreeDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @Type(() => Number)
  @Min(1)
  schemaVersion!: number;

  @IsObject()
  content!: Record<string, unknown>;
}

export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @IsEnum({
    PETITION: "PETITION",
    CONTRACT: "CONTRACT",
    NOTICE: "NOTICE",
    DEFENSE: "DEFENSE",
    INTERNAL_MEMO: "INTERNAL_MEMO",
  })
  type!: DocumentType;

  @Type(() => Number)
  @IsOptional()
  @Min(1)
  schemaVersion?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CanonicalTreeDto)
  canonicalJson?: CanonicalTreeDto;
}
