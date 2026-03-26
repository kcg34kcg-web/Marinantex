import { listThreadsSchema } from "@lexoffice/contracts";
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

    const input = listThreadsSchema.parse({
      tenantId,
      mailboxId: searchParams.get("mailboxId") ?? undefined,
      query: searchParams.get("query") ?? undefined,
      view: searchParams.get("view") ?? "inbox",
      labelId: searchParams.get("labelId") ?? undefined,
      readStatus: searchParams.get("readStatus") ?? "all",
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      withAttachments: searchParams.get("withAttachments") === "true",
      onlyStarred: searchParams.get("onlyStarred") === "true",
      sortBy: searchParams.get("sortBy") ?? "date",
      sortDirection: searchParams.get("sortDirection") ?? "desc",
      limit: searchParams.get("limit") ?? 25,
      cursor: searchParams.get("cursor") ?? undefined
    });

    const result = await services.mailThreadService.listThreads(input);
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
