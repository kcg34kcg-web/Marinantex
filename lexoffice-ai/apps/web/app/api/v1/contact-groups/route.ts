import {
  createContactGroupSchema,
  listContactGroupsSchema
} from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);
    const payload = listContactGroupsSchema.parse({
      tenantId: searchParams.get("tenantId") ?? "",
      query: searchParams.get("query") ?? undefined,
      limit: searchParams.get("limit") ?? undefined
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.CLIENT_MATTER_ACCESS
    );

    const groups = await services.contactGroupService.listContactGroups(payload);
    return ok({ groups });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = createContactGroupSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.CLIENT_MATTER_ACCESS
    );

    const group = await services.contactGroupService.createContactGroup(session.userId, payload);
    return ok({ group });
  } catch (error) {
    return fail(error);
  }
}
