import { createMatterSchema, listMattersSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);
    const payload = listMattersSchema.parse({
      tenantId: searchParams.get("tenantId") ?? "",
      clientId: searchParams.get("clientId") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      limit: searchParams.get("limit") ?? 25
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.CLIENT_MATTER_ACCESS
    );

    const matters = await services.matterService.listMatters(payload);
    return ok({ matters });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = createMatterSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.CLIENT_MATTER_ACCESS
    );

    const matter = await services.matterService.createMatter(session.userId, payload);
    return ok({ matter });
  } catch (error) {
    return fail(error);
  }
}
