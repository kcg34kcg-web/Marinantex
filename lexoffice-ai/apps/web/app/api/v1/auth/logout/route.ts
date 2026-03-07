import { cookies } from "next/headers";
import { fail, ok } from "@/lib/http";
import { services } from "@/lib/services";
import { getRequestMeta, SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  const meta = await getRequestMeta();

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;

    if (token) {
      await services.authService.logout(token, meta);
    }

    cookieStore.delete(SESSION_COOKIE);

    return ok({ success: true }, meta.requestId);
  } catch (error) {
    return fail(error, meta.requestId);
  }
}
