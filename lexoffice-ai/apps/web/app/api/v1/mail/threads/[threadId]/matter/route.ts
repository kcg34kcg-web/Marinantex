import { linkThreadToMatterSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ threadId: string }>;
  }
) {
  try {
    const session = await getServerSession();
    const params = await context.params;

    const payload = linkThreadToMatterSchema.parse({
      ...(await request.json()),
      threadId: params.threadId
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.CLIENT_MATTER_ACCESS);

    const result = await services.mailThreadService.linkThreadToMatter(session.userId, payload);
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
