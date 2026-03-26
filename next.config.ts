import type { NextConfig } from 'next';
import path from 'path';

const mailWorkspaceProxyTarget =
  process.env.MAIL_WORKSPACE_PROXY_TARGET?.trim() ||
  process.env.MAIL_WORKSPACE_URL?.trim() ||
  'http://localhost:3001';
const normalizedMailWorkspaceProxyTarget = mailWorkspaceProxyTarget.replace(/\/$/, '');

const nextConfig: NextConfig = {
  typedRoutes: true,
  outputFileTracingRoot: path.join(__dirname),
  async rewrites() {
    return [
      {
        source: '/mail-workspace/:path*',
        destination: `${normalizedMailWorkspaceProxyTarget}/mail-workspace/:path*`,
      },
      {
        source: '/api/v1/:path*',
        destination: `${normalizedMailWorkspaceProxyTarget}/mail-workspace/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
