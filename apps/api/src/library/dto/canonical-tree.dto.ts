import { Type } from "class-transformer";
import { IsNotEmpty, IsObject, IsString, Min } from "class-validator";

export class CanonicalTreeDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @Type(() => Number)
  @Min(1)
  schemaVersion!: number;

  @IsObject()
  content!: Record<string, unknown>;
}
