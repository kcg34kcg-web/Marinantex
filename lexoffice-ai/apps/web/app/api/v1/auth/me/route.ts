import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";

export async function GET() {
  try {
    const session = await getServerSession();

    return ok({
      sessionId: session.id,
      user: {
        id: session.user.id,
        email: session.user.email,
        firstName: session.user.firstName,
        lastName: session.user.lastName
      },
      tenantId: session.tenantId,
      expiresAt: session.expiresAt
    });
  } catch (error) {
    return fail(error);
  }
}
