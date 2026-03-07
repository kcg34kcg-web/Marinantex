import { Topbar } from "@/components/app/topbar";
import { SettingsForms } from "@/components/settings/settings-forms";
import { getTenantContext } from "@/lib/tenant-context";

export default async function TenantSettingsPage({
  params
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const { tenant } = await getTenantContext(tenantSlug);

  return (
    <>
      <Topbar title="Settings" subtitle="Tenant profil ve lokalizasyon ayarları" />
      <div className="p-4 sm:p-6">
        <SettingsForms tenantId={tenant.id} tenantName={tenant.name} locale={tenant.locale} timezone={tenant.timezone} />
      </div>
    </>
  );
}
