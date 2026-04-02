"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAV_ITEMS, Sidebar } from "./sidebar";

const MOBILE_NAV_ITEMS = APP_NAV_ITEMS.filter((item) =>
  ["dashboard", "mail", "tasks", "ai", "settings"].includes(item.href)
);

export function AppShell({
  tenantSlug,
  children
}: {
  tenantSlug: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isMailWorkspaceRoute = pathname.includes(`/${tenantSlug}/mail`);

  if (isMailWorkspaceRoute) {
    return <div className="min-h-screen bg-white text-slate-900">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[1800px]">
        <Sidebar tenantSlug={tenantSlug} />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col pb-16 lg:pb-0">{children}</div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 py-2 backdrop-blur lg:hidden">
        <ul className="grid grid-cols-5 gap-1">
          {MOBILE_NAV_ITEMS.map((item) => {
            const href = `/${tenantSlug}/${item.href}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={href}
                  className={`block rounded-lg px-2 py-2 text-center text-[11px] font-medium ${
                    active ? "bg-brand-50 text-brand-700" : "text-slate-600"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
