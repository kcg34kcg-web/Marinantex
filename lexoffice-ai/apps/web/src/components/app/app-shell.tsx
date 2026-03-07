import { Sidebar } from "./sidebar";

export function AppShell({
  tenantSlug,
  children
}: {
  tenantSlug: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[1800px]">
        <Sidebar tenantSlug={tenantSlug} />
        <div className="flex min-h-screen flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
