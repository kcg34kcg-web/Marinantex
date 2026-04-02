import path from "node:path";
import type { NextConfig } from "next";

const mailWorkspaceBasePath = process.env.MAIL_WORKSPACE_BASE_PATH?.trim() || "/mail-workspace";
const nextDistDir = process.env.NEXT_DIST_DIR?.trim() || ".next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  distDir: nextDistDir,
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
