'use client';

import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { DashboardHeader } from '@/components/layout/dashboard-header';
import { DashboardSidebar } from '@/components/layout/dashboard-sidebar';

import { CommandPalette } from '@/components/ui/command-palette';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMailWorkspaceRoute =
    pathname === '/mail' ||
    pathname.startsWith('/mail/') ||
    pathname === '/dashboard/mail' ||
    pathname.startsWith('/dashboard/mail/');

  if (isMailWorkspaceRoute) {
    return (
      <div className="min-h-screen w-full bg-white">
        <main className="min-h-screen w-full bg-white">{children}</main>
      </div>
    );
  }

  return (
    <div className="app-glass-shell flex min-h-screen">
      {/* Global Ctrl+K command palette — tüm dashboard sayfalarında aktif */}
      <CommandPalette />

      <Suspense fallback={<div className="hidden w-[280px] md:block" />}>
        <DashboardSidebar />
      </Suspense>

      <div className="app-main-pane flex min-w-0 flex-1 flex-col">
        <DashboardHeader />
        <main className="app-main-content flex-1 space-y-6 p-4 md:p-6 lg:p-7">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
