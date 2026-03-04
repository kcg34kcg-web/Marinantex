import type { UserRole } from "@prisma/client";

export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: UserRole;
}
