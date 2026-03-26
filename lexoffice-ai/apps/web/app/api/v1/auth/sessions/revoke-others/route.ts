import { UnauthorizedError } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";

export async function POST() {
  try {
    const session = await getServerSession();
    if (!session.tenantId) {
      throw new UnauthorizedError("Tenant bağlamı bulunamadı");
    }

    const result = await services.authService.revokeOtherSessions(
      session.userId,
      session.tenantId,
      session.id
    );

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
