import { toggleMessageLabelSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ messageId: string }>;
  }
) {
  try {
    const session = await getServerSession();
    const params = await context.params;
    const payload = toggleMessageLabelSchema.parse({
      ...(await request.json()),
      messageId: params.messageId
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.MAIL_LABEL_MANAGE
    );

    const result = await services.mailThreadService.toggleMessageLabel(session.userId, payload);
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
