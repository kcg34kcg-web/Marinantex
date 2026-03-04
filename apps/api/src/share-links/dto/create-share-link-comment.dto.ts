import { IsString, MaxLength, MinLength } from "class-validator";

export class CreateShareLinkCommentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  authorName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  body!: string;
}
