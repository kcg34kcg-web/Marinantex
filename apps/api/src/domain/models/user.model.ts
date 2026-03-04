import type { IsoDateTime, Uuid } from "./common.model";

export type UserRole =
  | "OWNER"
  | "ADMIN"
  | "EDITOR"
  | "REVIEWER"
  | "COMMENTER"
  | "VIEWER";

export interface UserModel {
  id: Uuid;
  tenantId: Uuid;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
