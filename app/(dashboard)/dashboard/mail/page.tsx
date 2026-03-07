import Link from 'next/link';
import { Mail, Inbox, SendHorizontal, Settings2 } from 'lucide-react';

export default function DashboardMailProjectPage() {
  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-sky-50 p-2 text-sky-700">
            <Mail className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">Mail Projesi</h2>
            <p className="mt-1 text-sm text-slate-600">
              Bu sayfa ofis mail akışları için proje merkezidir.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Link
          href="/dashboard/mail"
          className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-sm transition hover:border-slate-300 hover:shadow"
        >
          <Inbox className="mb-2 h-5 w-5 text-sky-700" />
          <p className="text-sm font-medium">Gelen Kutusu</p>
          <p className="mt-1 text-xs text-slate-500">Mail ekranı başlangıç noktası.</p>
        </Link>

        <Link
          href="/dashboard/settings"
          className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-sm transition hover:border-slate-300 hover:shadow"
        >
          <Settings2 className="mb-2 h-5 w-5 text-sky-700" />
          <p className="text-sm font-medium">Mail Ayarları</p>
          <p className="mt-1 text-xs text-slate-500">Domain ve bağlantı ayarlarına geçiş.</p>
        </Link>

        <Link
          href="/dashboard/news"
          className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-sm transition hover:border-slate-300 hover:shadow"
        >
          <SendHorizontal className="mb-2 h-5 w-5 text-sky-700" />
          <p className="text-sm font-medium">Mail Akış Notları</p>
          <p className="mt-1 text-xs text-slate-500">Proje ilerleme notlarını görüntüle.</p>
        </Link>
      </div>
    </section>
  );
}
