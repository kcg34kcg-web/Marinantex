import { revokeSessionSchema } from "@lexoffice/contracts";
import { UnauthorizedError } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    if (!session.tenantId) {
      throw new UnauthorizedError("Tenant bağlamı bulunamadı");
    }

    const payload = revokeSessionSchema.parse(await request.json());
    const result = await services.authService.revokeSession(session.userId, session.tenantId, payload);
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
