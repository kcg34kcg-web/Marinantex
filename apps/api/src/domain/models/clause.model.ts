import type { JsonValue, IsoDateTime, Uuid } from "./common.model";

export type ClauseCategory =
  | "GENERAL"
  | "LIABILITY"
  | "PAYMENT"
  | "TERMINATION"
  | "CONFIDENTIALITY"
  | "DISPUTE";

export interface ClauseModel {
  id: Uuid;
  tenantId: Uuid;
  title: string;
  category: ClauseCategory;
  bodyJson: JsonValue;
  createdById: Uuid;
  isActive: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
