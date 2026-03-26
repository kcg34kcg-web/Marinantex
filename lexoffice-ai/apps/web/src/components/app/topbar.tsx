export function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="app-topbar border-b border-slate-200 bg-white px-4 sm:px-6">
      <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
    </header>
  );
}
