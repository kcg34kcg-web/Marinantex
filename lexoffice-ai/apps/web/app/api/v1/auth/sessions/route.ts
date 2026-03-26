import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";

export async function GET() {
  try {
    const session = await getServerSession();

    if (!session.tenantId) {
      return ok({ sessions: [] });
    }

    const sessions = await services.authService.listSessions(session.userId, session.tenantId, session.id);
    return ok({ sessions });
  } catch (error) {
    return fail(error);
  }
}
