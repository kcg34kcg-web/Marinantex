import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class UpdateDocumentTitleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;
}
