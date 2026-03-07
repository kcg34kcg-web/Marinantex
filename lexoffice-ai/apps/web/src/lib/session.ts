import { cookies, headers } from "next/headers";
import { UnauthorizedError } from "@lexoffice/core";
import { services } from "./services";

export const SESSION_COOKIE = "lexoffice_session";

export async function getServerSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    throw new UnauthorizedError("Oturum bulunamadı");
  }

  const session = await services.authService.validateSession(token);
  if (!session) {
    throw new UnauthorizedError("Geçersiz veya süresi dolmuş oturum");
  }

  return session;
}

export async function getRequestMeta(): Promise<{
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}> {
  const incomingHeaders = await headers();
  const ipAddress =
    incomingHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    incomingHeaders.get("x-real-ip") ??
    undefined;
  const userAgent = incomingHeaders.get("user-agent") ?? undefined;
  const requestId = incomingHeaders.get("x-request-id") ?? undefined;

  return {
    ...(ipAddress === undefined ? {} : { ipAddress }),
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(requestId === undefined ? {} : { requestId })
  };
}
