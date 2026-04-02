export const ACCESS_TOKEN_COOKIE = "mx_access_token";
export const TENANT_ID_COOKIE = "mx_tenant_id";

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function readCookie(
  cookieHeader: string | string[] | undefined,
  key: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const header = Array.isArray(cookieHeader)
    ? cookieHeader.join("; ")
    : cookieHeader;
  if (!header) {
    return undefined;
  }

  const parts = header.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;
    const rawKey = trimmed.slice(0, equalsIndex).trim();
    if (rawKey !== key) continue;
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    return decodeCookieValue(rawValue);
  }

  return undefined;
}
