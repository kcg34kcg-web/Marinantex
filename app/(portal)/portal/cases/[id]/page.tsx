import { ClientSummaryAssistant } from '@/components/portal/client-summary-assistant';
import { PortalRiskAwareMessageBox } from '@/components/portal/portal-risk-aware-message-box';
import { PortalCaseWorkspace } from '@/components/portal/portal-case-workspace';
import { requirePortalTwoFactor } from '@/lib/portal/two-factor';

interface PortalCaseDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PortalCaseDetailPage({ params }: PortalCaseDetailPageProps) {
  const { id } = await params;
  await requirePortalTwoFactor(`/portal/cases/${id}`);

  return (
    <div className="space-y-4">
      <PortalCaseWorkspace caseId={id} />

      <ClientSummaryAssistant caseId={id} />
      <PortalRiskAwareMessageBox caseId={id} />
    </div>
  );
}
