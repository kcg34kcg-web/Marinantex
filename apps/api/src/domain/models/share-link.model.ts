import type { IsoDateTime, Uuid } from "./common.model";

export type SharePermission = "VIEW" | "COMMENT";

export interface ShareLinkModel {
  id: Uuid;
  tenantId: Uuid;
  documentId: Uuid;
  createdById: Uuid;
  tokenHash: string;
  permission: SharePermission;
  expiresAt: IsoDateTime;
  maxViews: number | null;
  viewCount: number;
  revokedAt: IsoDateTime | null;
  lastAccessedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}
