import { createTaskSchema, listTasksSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);
    const payload = listTasksSchema.parse({
      tenantId: searchParams.get("tenantId") ?? "",
      matterId: searchParams.get("matterId") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      assignedToId: searchParams.get("assignedToId") ?? undefined,
      limit: searchParams.get("limit") ?? 30
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.CLIENT_MATTER_ACCESS
    );

    const tasks = await services.taskService.listTasks(payload);
    return ok({ tasks });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = createTaskSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.CLIENT_MATTER_ACCESS
    );

    const task = await services.taskService.createTask(session.userId, payload);
    return ok({ task });
  } catch (error) {
    return fail(error);
  }
}
