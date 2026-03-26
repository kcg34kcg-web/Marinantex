import { updateTaskStatusSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ taskId: string }>;
  }
) {
  try {
    const session = await getServerSession();
    const params = await context.params;
    const payload = updateTaskStatusSchema.parse({
      ...(await request.json()),
      taskId: params.taskId
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.CLIENT_MATTER_ACCESS
    );

    const task = await services.taskService.updateTaskStatus(session.userId, payload);
    return ok({ task });
  } catch (error) {
    return fail(error);
  }
}
