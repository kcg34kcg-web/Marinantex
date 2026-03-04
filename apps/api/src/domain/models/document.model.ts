import type {
  CanonicalDocumentTree,
  IsoDateTime,
  Uuid,
} from "./common.model";

export type DocumentType =
  | "PETITION"
  | "CONTRACT"
  | "NOTICE"
  | "DEFENSE"
  | "INTERNAL_MEMO";

export type DocumentStatus = "DRAFT" | "REVIEW" | "FINAL" | "ARCHIVED";

export interface DocumentModel {
  id: Uuid;
  tenantId: Uuid;
  ownerId: Uuid;
  title: string;
  type: DocumentType;
  status: DocumentStatus;
  schemaVersion: number;
  canonicalJson: CanonicalDocumentTree;
  latestVersion: number;
  finalVersionId: Uuid | null;
  finalContentHash: string | null;
  finalizedAt: IsoDateTime | null;
  archivedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
