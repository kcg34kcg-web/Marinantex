import { createMailLabelSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId") ?? "";
    const mailboxId = searchParams.get("mailboxId") ?? undefined;

    assertTenantAccess(session.tenantId, tenantId);
    await services.rbacService.requirePermission(session.userId, tenantId, PERMISSIONS.MAILBOX_VIEW);

    const labels = await services.mailThreadService.listLabels(tenantId, mailboxId);
    return ok({ labels });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = createMailLabelSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.MAIL_LABEL_MANAGE
    );

    const label = await services.mailThreadService.createLabel(session.userId, payload);
    return ok({ label });
  } catch (error) {
    return fail(error);
  }
}
