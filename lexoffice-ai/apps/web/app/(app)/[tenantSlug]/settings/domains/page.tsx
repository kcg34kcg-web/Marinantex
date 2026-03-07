import { Topbar } from "@/components/app/topbar";
import { DomainManagementPanel } from "@/components/domains/domain-management-panel";
import { MailboxConnectWizard } from "@/components/domains/mailbox-connect-wizard";
import { getTenantContext } from "@/lib/tenant-context";

export default async function DomainSettingsPage({
  params,
  searchParams
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    oauth?: string;
    provider?: string;
    mailbox?: string;
    reason?: string;
  }>;
}) {
  const { tenantSlug } = await params;
  const query = await searchParams;
  const { tenant } = await getTenantContext(tenantSlug);

  const oauthStatus =
    query.oauth === "success"
      ? {
          state: "success" as const,
          ...(query.provider ? { provider: query.provider } : {}),
          ...(query.mailbox ? { mailbox: query.mailbox } : {})
        }
      : query.oauth === "error"
        ? {
            state: "error" as const,
            ...(query.provider ? { provider: query.provider } : {}),
            ...(query.reason ? { reason: query.reason } : {})
          }
        : undefined;

  return (
    <>
      <Topbar
        title="Domain ve Mailbox Yönetimi"
        subtitle="DNS doğrulama, provider bağlantı ve sağlık izleme"
      />
      <div className="grid gap-4 p-4 sm:p-6 xl:grid-cols-[1fr_380px]">
        <DomainManagementPanel tenantId={tenant.id} />
        <div className="space-y-4">
          <MailboxConnectWizard
            tenantId={tenant.id}
            tenantSlug={tenantSlug}
            {...(oauthStatus ? { oauthStatus } : {})}
          />
        </div>
      </div>
    </>
  );
}
