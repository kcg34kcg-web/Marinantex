import { Suspense } from 'react';
import { KaynakIctihatSearchPage } from '@/components/tools/kaynak-ictihat-search-page';

export default function KaynakIctihatAramaRoute() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-slate-500">Arama yükleniyor...</div>}>
      <KaynakIctihatSearchPage />
    </Suspense>
  );
}
