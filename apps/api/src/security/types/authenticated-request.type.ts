import type { Request } from "express";
import type { JwtPayload } from "../../auth/types/jwt-payload.type";

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  tenantId?: string;
}
