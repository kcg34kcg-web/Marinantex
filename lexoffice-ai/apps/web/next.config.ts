import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  transpilePackages: ["@lexoffice/contracts", "@lexoffice/core", "@lexoffice/db", "@lexoffice/mail", "@lexoffice/ui"],
  typedRoutes: false
};

export default nextConfig;
