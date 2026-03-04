import type {
  CanonicalDocumentTree,
  IsoDateTime,
  Uuid,
} from "./common.model";

export interface DocumentVersionModel {
  id: Uuid;
  tenantId: Uuid;
  documentId: Uuid;
  versionNumber: number;
  schemaVersion: number;
  canonicalJson: CanonicalDocumentTree;
  snapshotHash: string;
  isFinalSnapshot: boolean;
  createdById: Uuid;
  createdAt: IsoDateTime;
}
