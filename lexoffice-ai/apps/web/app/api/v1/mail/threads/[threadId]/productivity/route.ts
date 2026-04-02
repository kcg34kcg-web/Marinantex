import { getThreadProductivitySchema, updateThreadProductivitySchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

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

    const payload = getThreadProductivitySchema.parse({
      tenantId: searchParams.get("tenantId") ?? "",
      threadId: params.threadId
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.MAILBOX_VIEW);

    const productivity = await services.mailThreadService.getThreadProductivity(
      payload.tenantId,
      payload.threadId
    );
    return ok({ productivity });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ threadId: string }>;
  }
) {
  try {
    const session = await getServerSession();
    const params = await context.params;

    const payload = updateThreadProductivitySchema.parse({
      ...(await request.json()),
      threadId: params.threadId
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.MAILBOX_VIEW);

    const productivity = await services.mailThreadService.updateThreadProductivity(session.userId, payload);
    return ok({ productivity });
  } catch (error) {
    return fail(error);
  }
}
