import type { IsoDateTime, JsonValue, Uuid } from "./common.model";

export type AuditAction =
  | "DOCUMENT_CREATED"
  | "DOCUMENT_UPDATED"
  | "DOCUMENT_STATUS_CHANGED"
  | "DOCUMENT_VERSION_CREATED"
  | "DOCUMENT_FINALIZED"
  | "TEMPLATE_CREATED"
  | "TEMPLATE_UPDATED"
  | "CLAUSE_CREATED"
  | "CLAUSE_UPDATED"
  | "SHARE_LINK_CREATED"
  | "SHARE_LINK_REVOKED"
  | "SHARE_LINK_VIEWED"
  | "AUTH_LOGIN_SUCCESS"
  | "AUTH_LOGIN_FAILED"
  | "AUTH_TOKEN_REFRESHED";

export type AuditObjectType =
  | "DOCUMENT"
  | "DOCUMENT_VERSION"
  | "TEMPLATE"
  | "CLAUSE"
  | "SHARE_LINK"
  | "AUTH"
  | "SYSTEM";

export type DataClassification =
  | "general"
  | "sensitive_case"
  | "special_category_possible"
  | "final_document";

export interface AuditLogModel {
  id: Uuid;
  tenantId: Uuid;
  actorUserId: Uuid | null;
  action: AuditAction;
  objectType: AuditObjectType;
  objectId: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgentHash: string | null;
  metadata: JsonValue | null;
  occurredAt: IsoDateTime;
  dataClassification: DataClassification;
}
