import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";
import { PERMISSIONS } from "@lexoffice/core";

export async function GET(
  request: Request,
  context: {
    params: Promise<{ domainId: string }>;
  }
) {
  try {
    const session = await getServerSession();
    const params = await context.params;
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId") ?? "";

    assertTenantAccess(session.tenantId, tenantId);
    await services.rbacService.requirePermission(session.userId, tenantId, PERMISSIONS.DOMAIN_MANAGE);

    const domain = await services.domainService.getDomain(tenantId, params.domainId);
    return ok({ domain });
  } catch (error) {
    return fail(error);
  }
}
