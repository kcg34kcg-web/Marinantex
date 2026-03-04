export interface CanonicalDocumentTree {
  type: string;
  schemaVersion: number;
  content: Record<string, unknown>;
}

export interface TemplateItem {
  id: string;
  name: string;
  description?: string | null;
  documentType: "PETITION" | "CONTRACT" | "NOTICE" | "DEFENSE" | "INTERNAL_MEMO";
  schemaVersion: number;
  canonicalJson: Record<string, unknown>;
}

export interface ClauseItem {
  id: string;
  title: string;
  category:
    | "GENERAL"
    | "LIABILITY"
    | "PAYMENT"
    | "TERMINATION"
    | "CONFIDENTIALITY"
    | "DISPUTE";
  bodyJson: Record<string, unknown>;
}

export interface DynamicFieldDefinition {
  fieldKey: string;
  label: string;
  defaultValue?: string;
}

export type DocumentStatus = "DRAFT" | "REVIEW" | "FINAL" | "ARCHIVED";

export type DocumentExportFormat = "PDF" | "DOCX";

export type DocumentExportStatus =
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "EXPIRED";

export interface DocumentExportItem {
  id: string;
  documentId: string;
  format: DocumentExportFormat;
  status: DocumentExportStatus;
  queueJobId?: string | null;
  checksum?: string | null;
  fileSizeBytes?: number | null;
  failureReason?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

export interface DocumentSummary {
  id: string;
  title: string;
  type: "PETITION" | "CONTRACT" | "NOTICE" | "DEFENSE" | "INTERNAL_MEMO";
  status: DocumentStatus;
  schemaVersion: number;
  latestVersion: number;
}

export type SharePermission = "VIEW" | "COMMENT";

export interface ShareLinkItem {
  id: string;
  documentId: string;
  permission: SharePermission;
  expiresAt: string;
  maxViews: number | null;
  viewCount: number;
  revokedAt?: string | null;
  lastAccessedAt?: string | null;
  createdAt: string;
}
