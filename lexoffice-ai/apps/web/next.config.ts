import path from "node:path";
import type { NextConfig } from "next";

const mailWorkspaceBasePath = process.env.MAIL_WORKSPACE_BASE_PATH?.trim() || "/mail-workspace";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  transpilePackages: ["@lexoffice/contracts", "@lexoffice/core", "@lexoffice/db", "@lexoffice/mail", "@lexoffice/ui"],
  typedRoutes: false,
  basePath: mailWorkspaceBasePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: mailWorkspaceBasePath
  }
};

export default nextConfig;
