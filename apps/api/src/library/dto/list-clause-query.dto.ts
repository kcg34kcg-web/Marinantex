import { IsEnum, IsOptional } from "class-validator";
import type { ClauseCategory } from "@prisma/client";

export class ListClauseQueryDto {
  @IsOptional()
  @IsEnum({
    GENERAL: "GENERAL",
    LIABILITY: "LIABILITY",
    PAYMENT: "PAYMENT",
    TERMINATION: "TERMINATION",
    CONFIDENTIALITY: "CONFIDENTIALITY",
    DISPUTE: "DISPUTE",
  })
  category?: ClauseCategory;
}
