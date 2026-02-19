import { Gavel } from 'lucide-react';
import { logoutAndRedirectAction } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';

export function DashboardHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-white/95 px-6 py-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500">Babylexit Hukuk İşletim Sistemi</p>
          <h1 className="text-lg font-semibold text-slate-900">Avukat Paneli</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-1.5 text-sm text-orange-700">
            <Gavel className="h-4 w-4" />
            Yetkili Kullanıcı
          </div>
          <form action={logoutAndRedirectAction}>
            <Button type="submit" variant="outline">
              Çıkış Yap
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
