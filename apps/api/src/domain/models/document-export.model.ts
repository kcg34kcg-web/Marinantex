import type { IsoDateTime, Uuid } from "./common.model";

export type ExportFormat = "PDF" | "DOCX";

export type ExportStatus =
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "EXPIRED";

export interface DocumentExportModel {
  id: Uuid;
  tenantId: Uuid;
  documentId: Uuid;
  requestedById: Uuid;
  format: ExportFormat;
  status: ExportStatus;
  queueJobId: string | null;
  storageKey: string | null;
  checksum: string | null;
  fileSizeBytes: number | null;
  failureReason: string | null;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  expiresAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
