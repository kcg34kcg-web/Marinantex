import {
  deleteContactSchema,
  updateContactSchema
} from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ contactId: string }> }
) {
  try {
    const session = await getServerSession();
    const { contactId } = await params;
    const body = (await request.json()) as { tenantId?: string };
    const payload = updateContactSchema.parse({
      ...body,
      contactId
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.CLIENT_MATTER_ACCESS
    );

    const contact = await services.contactService.updateContact(session.userId, payload);
    return ok({ contact });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ contactId: string }> }
) {
  try {
    const session = await getServerSession();
    const { contactId } = await params;
    const body = (await request.json()) as { tenantId?: string };
    const payload = deleteContactSchema.parse({
      ...body,
      contactId
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.CLIENT_MATTER_ACCESS
    );

    await services.contactService.deleteContact(session.userId, payload);
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
