import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import type { ClauseCategory } from "@prisma/client";

export class CreateClauseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  title!: string;

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

  @IsObject()
  bodyJson!: Record<string, unknown>;
}
