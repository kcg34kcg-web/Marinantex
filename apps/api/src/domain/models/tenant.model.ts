import type { IsoDateTime, Uuid } from "./common.model";

export type TenantStatus = "ACTIVE" | "SUSPENDED" | "DELETED";

export interface TenantModel {
  id: Uuid;
  slug: string;
  name: string;
  status: TenantStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
