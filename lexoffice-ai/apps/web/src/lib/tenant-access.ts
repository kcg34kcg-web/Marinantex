import { ForbiddenError } from "@lexoffice/core";

export function assertTenantAccess(sessionTenantId: string | null, targetTenantId: string): void {
  if (!sessionTenantId || sessionTenantId !== targetTenantId) {
    throw new ForbiddenError("Tenant erişimi reddedildi");
  }
}
