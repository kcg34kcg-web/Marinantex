import { LitigationIntelligencePanel } from '@/components/dashboard/litigation-intelligence-panel';

interface IntelligencePageProps {
  params: Promise<{ id: string }>;
}

export default async function IntelligencePage({ params }: IntelligencePageProps) {
  const { id } = await params;

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Litigation Intelligence Merkezi</h1>
      <LitigationIntelligencePanel caseId={id} />
    </section>
  );
}
