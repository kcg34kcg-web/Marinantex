import { Scroll, FileText, Upload } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { Tabs } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { PetitionWizard } from '@/components/dashboard/petition-wizard';

interface CaseDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function CaseDetailPage({ params }: CaseDetailPageProps) {
  const { id } = await params;

  const tabItems = [
    {
      value: 'overview',
      label: 'Genel Bakış',
      content: (
        <Card>
          <CardContent className="space-y-2 p-4 text-sm text-slate-700">
            <p>Dosya No: {id}</p>
            <p>İlgili mevzuat ve süreç notları burada görüntülenecek.</p>
          </CardContent>
        </Card>
      ),
    },
    {
      value: 'documents',
      label: 'Belgeler',
      content: (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-slate-800">
              <FileText className="h-4 w-4 text-blue-600" />
              Belge listesi ve sürümleri
            </div>
            <div className="rounded-lg border-2 border-dashed border-orange-300 bg-orange-50 p-6 text-center text-sm text-orange-700">
              <Upload className="mx-auto mb-2 h-4 w-4" />
              Belgeyi sürükleyip bırakın
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      value: 'timeline',
      label: 'Zaman Çizelgesi',
      content: (
        <div className="space-y-3">
          <div className="rounded-md border-l-4 border-blue-600 bg-blue-50 p-3 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium text-blue-800">
              <Scroll className="h-4 w-4" />
              Dahili Not
            </div>
            Dava stratejisi toplantısı planlandı.
          </div>
          <div className="rounded-md border-l-4 border-orange-500 bg-orange-50 p-3 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium text-orange-800">
              <Scroll className="h-4 w-4" />
              Müvekkil Görür
            </div>
            Duruşma tarihi müvekkille paylaşıldı.
          </div>
        </div>
      ),
    },
    {
      value: 'petition',
      label: 'Dilekçe Sihirbazı',
      content: <PetitionWizard caseId={id} />,
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Dosya Detayı</h1>
        <div className="flex items-center gap-4">
          <Link href={`/cases/${id}/finance` as Route} className="text-sm font-medium text-blue-600 hover:underline">
            Finans Zekâsı Sayfasına Git
          </Link>
          <Link href={`/cases/${id}/intelligence` as Route} className="text-sm font-medium text-blue-600 hover:underline">
            Litigation Intelligence Sayfasına Git
          </Link>
        </div>
      </div>
      <Tabs items={tabItems} />
    </section>
  );
}
