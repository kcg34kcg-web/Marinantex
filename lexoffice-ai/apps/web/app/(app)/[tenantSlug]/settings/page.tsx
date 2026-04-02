import { Topbar } from "@/components/app/topbar";
import { SettingsForms } from "@/components/settings/settings-forms";
import { getTenantContext } from "@/lib/tenant-context";

type ComposeFont = "system" | "sans" | "serif" | "mono";

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
        <SettingsForms
          tenantId={tenant.id}
          tenantName={tenant.name}
          locale={tenant.locale}
          timezone={tenant.timezone}
          mailConversationViewEnabled={tenant.settings?.mailConversationViewEnabled ?? true}
          composeDefaultFont={normalizeComposeFont(tenant.settings?.composeDefaultFont)}
          defaultSenderMailboxId={tenant.settings?.defaultSenderMailboxId ?? null}
          mailForwardingEnabled={tenant.settings?.mailForwardingEnabled ?? false}
          mailForwardingRecipients={tenant.settings?.mailForwardingRecipients ?? []}
          mailForwardingMailboxId={tenant.settings?.mailForwardingMailboxId ?? null}
          autoResponderEnabled={tenant.settings?.autoResponderEnabled ?? false}
          autoResponderSubject={tenant.settings?.autoResponderSubject ?? ""}
          autoResponderBodyText={tenant.settings?.autoResponderBodyText ?? ""}
        />
      </div>
    </>
  );
}

function normalizeComposeFont(value: string | null | undefined): ComposeFont {
  if (value === "sans" || value === "serif" || value === "mono") {
    return value;
  }

  return "system";
}
