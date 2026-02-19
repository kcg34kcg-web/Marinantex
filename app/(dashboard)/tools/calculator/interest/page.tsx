import { InterestCalculatorForm } from '@/components/tools/interest-calculator-form';

export default function InterestCalculatorPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Faiz Hesaplama Aracı</h1>
      <InterestCalculatorForm />
    </section>
  );
}
