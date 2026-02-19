import { OfficeDocumentAnalyzeForm } from '@/components/office/office-document-analyze-form';

export default function OfficeDocumentsPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Ofisim / Belge Analizi</h2>
      <OfficeDocumentAnalyzeForm activeRole="lawyer" />
    </div>
  );
}
