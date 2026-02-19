import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClientSummaryAssistant } from '@/components/portal/client-summary-assistant';
import { PortalRiskAwareMessageBox } from '@/components/portal/portal-risk-aware-message-box';
import { requirePortalTwoFactor } from '@/lib/portal/two-factor';

interface PortalCaseDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PortalCaseDetailPage({ params }: PortalCaseDetailPageProps) {
  const { id } = await params;
  await requirePortalTwoFactor(`/portal/cases/${id}`);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Dosya Detayı</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-700">
          <p>Dosya Kimliği: {id}</p>
          <p>Bu alanda yalnızca müvekkile açık güncellemeler görüntülenir.</p>
        </CardContent>
      </Card>

      <ClientSummaryAssistant caseId={id} />
      <PortalRiskAwareMessageBox caseId={id} />
    </div>
  );
}
