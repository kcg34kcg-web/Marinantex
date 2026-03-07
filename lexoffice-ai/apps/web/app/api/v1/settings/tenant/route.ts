import { updateTenantProfileSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = updateTenantProfileSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.DOMAIN_MANAGE);

    const tenant = await services.tenantService.updateTenantProfile(session.userId, payload);
    return ok({ tenant });
  } catch (error) {
    return fail(error);
  }
}
