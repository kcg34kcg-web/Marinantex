import { CaseDetailWorkspace } from '@/components/dashboard/case-detail-workspace';

interface CaseDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function CaseDetailPage({ params }: CaseDetailPageProps) {
  const { id } = await params;

  return <CaseDetailWorkspace caseId={id} />;
}

