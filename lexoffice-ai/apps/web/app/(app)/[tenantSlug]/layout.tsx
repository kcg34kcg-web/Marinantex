import { AppShell } from "@/components/app/app-shell";
import { getTenantContext } from "@/lib/tenant-context";

export default async function TenantLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  await getTenantContext(tenantSlug);

  return <AppShell tenantSlug={tenantSlug}>{children}</AppShell>;
}
