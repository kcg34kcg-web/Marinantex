import { listMailboxesSchema, connectMailboxSchema } from "@lexoffice/contracts";
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

    assertTenantAccess(session.tenantId, tenantId);
    await services.rbacService.requirePermission(session.userId, tenantId, PERMISSIONS.MAILBOX_VIEW);

    const input = listMailboxesSchema.parse({
      tenantId,
      provider: searchParams.get("provider") ?? undefined
    });

    const mailboxes = await services.mailboxService.listMailboxes(input);
    return ok({ mailboxes });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = connectMailboxSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.MAILBOX_CONNECT);

    const mailbox = await services.mailboxService.connectMailbox(session.userId, payload);
    return ok({ mailbox });
  } catch (error) {
    return fail(error);
  }
}
