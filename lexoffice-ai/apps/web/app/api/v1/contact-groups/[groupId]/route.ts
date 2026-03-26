import {
  deleteContactGroupSchema,
  updateContactGroupSchema
} from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const session = await getServerSession();
    const { groupId } = await params;
    const body = (await request.json()) as { tenantId?: string };
    const payload = updateContactGroupSchema.parse({
      ...body,
      groupId
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.CLIENT_MATTER_ACCESS
    );

    const group = await services.contactGroupService.updateContactGroup(session.userId, payload);
    return ok({ group });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const session = await getServerSession();
    const { groupId } = await params;
    const body = (await request.json()) as { tenantId?: string };
    const payload = deleteContactGroupSchema.parse({
      ...body,
      groupId
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.CLIENT_MATTER_ACCESS
    );

    await services.contactGroupService.deleteContactGroup(session.userId, payload);
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
