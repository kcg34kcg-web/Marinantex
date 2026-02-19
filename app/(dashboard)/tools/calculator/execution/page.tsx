import { ExecutionCalculatorForm } from '@/components/tools/execution-calculator-form';

export default function ExecutionCalculatorPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">İcra Masrafı Analizi</h1>
      <ExecutionCalculatorForm />
    </section>
  );
}
