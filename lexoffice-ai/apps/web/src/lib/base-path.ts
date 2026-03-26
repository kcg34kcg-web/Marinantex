const RAW_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? process.env.MAIL_WORKSPACE_BASE_PATH ?? "";

export const APP_BASE_PATH = normalizeBasePath(RAW_BASE_PATH);

export function withBasePath(pathname: string): string {
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (!APP_BASE_PATH) {
    return normalizedPathname;
  }
  return `${APP_BASE_PATH}${normalizedPathname}`;
}

function normalizeBasePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}
