import { aiStatsQuerySchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);
    const payload = aiStatsQuerySchema.parse({
      tenantId: searchParams.get("tenantId") ?? ""
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.AI_WORKSPACE
    );

    const result = await services.aiService.getSuggestionStats(session.userId, payload);
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
