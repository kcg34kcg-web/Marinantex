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
        lastName: session.user.lastName,
        mfaEnabled: session.user.mfaEnabled
      },
      tenantId: session.tenantId,
      expiresAt: session.expiresAt,
      mfaVerifiedAt: session.mfaVerifiedAt
    });
  } catch (error) {
    return fail(error);
  }
}
