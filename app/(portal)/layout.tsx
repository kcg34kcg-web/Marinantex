import Link from 'next/link';
import { isWithinBusinessHours } from '@/lib/portal/availability';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const isAvailable = isWithinBusinessHours();

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="text-lg font-semibold text-blue-600">Müvekkil Portalı</h1>
          <Link href="/portal" className="text-sm text-slate-600 hover:text-slate-900">
            Ana Sayfa
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">
        <div className="mb-4 rounded-md border border-border bg-slate-50 px-4 py-2 text-xs text-slate-700">
          {isAvailable
            ? 'Mesai saatleri içindesiniz (09:00-18:00). Talepleriniz öncelikli işlenir.'
            : 'Şu an mesai dışındasınız. Mesajlarınız kaydedilir, ilk mesai saatinde önceliklenir.'}
        </div>
        {children}
      </main>
    </div>
  );
}
