import { Type } from "class-transformer";
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

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

export class UpdateDocumentContentDto {
  @Type(() => Number)
  @Min(1)
  schemaVersion!: number;

  @ValidateNested()
  @Type(() => CanonicalTreeDto)
  canonicalJson!: CanonicalTreeDto;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;
}
