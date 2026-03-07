import { PERMISSIONS } from "@lexoffice/core";
import { verifyDomainSchema } from "@lexoffice/contracts";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ domainId: string }>;
  }
) {
  try {
    const session = await getServerSession();
    const params = await context.params;
    const payload = verifyDomainSchema.parse({
      ...(await request.json()),
      domainId: params.domainId
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.DOMAIN_MANAGE);

    const domain = await services.domainService.verifyDomain(session.userId, payload);
    return ok({ domain });
  } catch (error) {
    return fail(error);
  }
}
