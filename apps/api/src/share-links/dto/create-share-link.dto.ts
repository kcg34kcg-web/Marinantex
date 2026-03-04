import { SharePermission } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";

export class CreateShareLinkDto {
  @IsEnum(SharePermission)
  permission!: SharePermission;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  expiresInHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  maxViews?: number;
}
