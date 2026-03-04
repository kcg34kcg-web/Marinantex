import { Type } from "class-transformer";
import { IsOptional, Max, Min } from "class-validator";

export class LockLeaseDto {
  @IsOptional()
  @Type(() => Number)
  @Min(30)
  @Max(600)
  leaseSeconds?: number;
}
