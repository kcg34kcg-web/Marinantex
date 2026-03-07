import { listDomainsSchema, addDomainSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);

    const tenantId = searchParams.get("tenantId") ?? "";

    assertTenantAccess(session.tenantId, tenantId);
    await services.rbacService.requirePermission(session.userId, tenantId, PERMISSIONS.DOMAIN_MANAGE);

    const input = listDomainsSchema.parse({
      tenantId,
      status: searchParams.get("status") ?? undefined
    });

    const domains = await services.domainService.listDomains(input);
    return ok({ domains });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = addDomainSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.DOMAIN_MANAGE);

    const domain = await services.domainService.addDomain(session.userId, payload);
    return ok({ domain });
  } catch (error) {
    return fail(error);
  }
}
