import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";
import { PERMISSIONS } from "@lexoffice/core";

export async function GET(
  request: Request,
  context: {
    params: Promise<{ threadId: string }>;
  }
) {
  try {
    const session = await getServerSession();
    const params = await context.params;

    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId") ?? "";

    assertTenantAccess(session.tenantId, tenantId);
    await services.rbacService.requirePermission(session.userId, tenantId, PERMISSIONS.MAILBOX_VIEW);

    const thread = await services.mailThreadService.getThread(tenantId, params.threadId);
    return ok({ thread });
  } catch (error) {
    return fail(error);
  }
}
