import type {
  CanonicalDocumentTree,
  IsoDateTime,
  Uuid,
} from "./common.model";
import type { DocumentType } from "./document.model";

export interface TemplateModel {
  id: Uuid;
  tenantId: Uuid;
  name: string;
  description: string | null;
  documentType: DocumentType;
  schemaVersion: number;
  canonicalJson: CanonicalDocumentTree;
  createdById: Uuid;
  isActive: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
