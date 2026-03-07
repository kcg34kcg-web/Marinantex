import { createDraftSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = createDraftSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.MAIL_DRAFT_SAVE);

    const draft = await services.mailThreadService.createOrAutosaveDraft(session.userId, payload);
    return ok({ draft });
  } catch (error) {
    return fail(error);
  }
}
