import { SetMetadata } from "@nestjs/common";

export type DocumentPermission =
  | "view"
  | "comment"
  | "edit"
  | "finalize"
  | "status";

export const DOCUMENT_ACCESS_KEY = "document_access";
export const DocumentAccess = (permission: DocumentPermission) =>
  SetMetadata(DOCUMENT_ACCESS_KEY, permission);
