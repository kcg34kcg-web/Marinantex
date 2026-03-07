import { cookies } from "next/headers";
import { loginSchema } from "@lexoffice/contracts";
import { fail, ok } from "@/lib/http";
import { services } from "@/lib/services";
import { getRequestMeta, SESSION_COOKIE } from "@/lib/session";

export async function POST(request: Request) {
  const meta = await getRequestMeta();

  try {
    const payload = loginSchema.parse(await request.json());
    const result = await services.authService.login(payload, meta);

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.AUTH_COOKIE_SECURE === "true",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });

    return ok(
      {
        sessionId: result.sessionId,
        expiresAt: result.expiresAt,
        user: result.user,
        tenant: result.tenant,
        role: result.role
      },
      meta.requestId
    );
  } catch (error) {
    return fail(error, meta.requestId);
  }
}
