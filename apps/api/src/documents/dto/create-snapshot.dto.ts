import { IsBoolean, IsOptional } from "class-validator";

export class CreateSnapshotDto {
  @IsOptional()
  @IsBoolean()
  isFinalSnapshot?: boolean;
}
