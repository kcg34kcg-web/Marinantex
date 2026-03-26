import { updateMessageFlagsSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ messageId: string }>;
  }
) {
  try {
    const session = await getServerSession();
    const params = await context.params;
    const payload = updateMessageFlagsSchema.parse({
      ...(await request.json()),
      messageId: params.messageId
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.MAILBOX_VIEW);

    const message = await services.mailThreadService.updateMessageFlags(session.userId, payload);
    return ok({ message });
  } catch (error) {
    return fail(error);
  }
}
