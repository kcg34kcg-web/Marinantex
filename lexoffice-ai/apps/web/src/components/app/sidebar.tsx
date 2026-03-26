import Link from "next/link";

export const APP_NAV_ITEMS = [
  { href: "dashboard", label: "Dashboard" },
  { href: "mail", label: "Mail" },
  { href: "clients", label: "Clients" },
  { href: "matters", label: "Matters" },
  { href: "tasks", label: "Tasks" },
  { href: "ai", label: "AI Workspace" },
  { href: "settings", label: "Ayarlar" },
  { href: "settings/domains", label: "Domainler" },
  { href: "admin", label: "Admin" },
  { href: "admin/audit", label: "Audit" }
];

export function Sidebar({ tenantSlug }: { tenantSlug: string }) {
  return (
    <aside className="app-sidebar hidden shrink-0 border-r border-slate-200 bg-white lg:block">
      <div className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">LexOffice AI</p>
        <p className="mt-1 text-sm text-slate-700">/{tenantSlug}</p>
      </div>
      <nav className="space-y-1 px-3 pb-4">
        {APP_NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={`/${tenantSlug}/${item.href}`}
            className="app-sidebar-link block rounded-lg text-sm text-slate-700 hover:bg-slate-100"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
