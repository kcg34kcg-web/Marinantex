import { inviteMemberSchema } from "@lexoffice/contracts";
import { ForbiddenError, PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = inviteMemberSchema.parse(await request.json());

    if (session.tenantId !== payload.tenantId) {
      throw new ForbiddenError("Tenant uyuşmazlığı");
    }

    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.USER_INVITE);

    const membership = await services.tenantService.inviteMember(session.userId, payload);

    return ok({
      membershipId: membership.id,
      userId: membership.userId,
      roleId: membership.roleId,
      status: membership.status
    });
  } catch (error) {
    return fail(error);
  }
}
