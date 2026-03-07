import { DashboardHeader } from '@/components/layout/dashboard-header';
import { DashboardSidebar } from '@/components/layout/dashboard-sidebar';

import { CommandPalette } from '@/components/ui/command-palette';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-glass-shell flex min-h-screen">
      {/* Global Ctrl+K command palette — tüm dashboard sayfalarında aktif */}
      <CommandPalette />

      <DashboardSidebar />

      <div className="app-main-pane flex min-w-0 flex-1 flex-col">
        <DashboardHeader />
        <main className="app-main-content flex-1 space-y-6 p-4 md:p-6 lg:p-7">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
