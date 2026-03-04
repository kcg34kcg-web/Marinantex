import { IsBoolean, IsOptional } from "class-validator";
import { UpdateDocumentContentDto } from "./update-document-content.dto";

export class AutosaveDocumentDto extends UpdateDocumentContentDto {
  @IsOptional()
  @IsBoolean()
  recoveredFromCrash?: boolean;
}
