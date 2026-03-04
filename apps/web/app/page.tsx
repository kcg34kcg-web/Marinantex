import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-10 shadow-sm">
        <p className="mb-3 inline-flex rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
          Step 1 Scaffold
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Marinantex Hukuk Asistani Belge Editoru
        </h1>
        <p className="mt-4 text-slate-600">
          Next.js App Router frontend ayaga kalkti. Sonraki adimlarda editor
          cekirdegi, auth ve belge alan modeli eklenecek.
        </p>

        <div className="mt-8 grid gap-3 text-sm text-slate-700">
          <p>
            Web: <code className="rounded bg-slate-100 px-2 py-1">:3000</code>
          </p>
          <p>
            API Health:{" "}
            <code className="rounded bg-slate-100 px-2 py-1">
              http://localhost:4000/health
            </code>
          </p>
          <p>
            UYAP Bilgi:{" "}
            <code className="rounded bg-slate-100 px-2 py-1">
              MVP&apos;de UDF export yok
            </code>
          </p>
          <Link
            href="/editor/local-demo-document"
            className="mt-3 inline-flex w-fit rounded-lg bg-brand-500 px-4 py-2 font-semibold text-white hover:bg-brand-700"
          >
            Editor Shell v1 Aç
          </Link>
        </div>
      </div>
    </main>
  );
}
