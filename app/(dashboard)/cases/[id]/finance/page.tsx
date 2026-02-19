import { CaseFinancePanel } from '@/components/dashboard/case-finance-panel';

interface CaseFinancePageProps {
  params: Promise<{ id: string }>;
}

export default async function CaseFinancePage({ params }: CaseFinancePageProps) {
  const { id } = await params;

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Stratejik Hukuki Finans Zekâsı</h1>
      <CaseFinancePanel caseId={id} />
    </section>
  );
}
