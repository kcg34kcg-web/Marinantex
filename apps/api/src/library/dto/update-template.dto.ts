import { Type } from "class-transformer";
import {
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { CanonicalTreeDto } from "./canonical-tree.dto";

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  schemaVersion?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CanonicalTreeDto)
  canonicalJson?: CanonicalTreeDto;
}
