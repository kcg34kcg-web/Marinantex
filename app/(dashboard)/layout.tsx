import { DashboardHeader } from '@/components/layout/dashboard-header';
import { DashboardSidebar } from '@/components/layout/dashboard-sidebar';
import { AiChat } from '@/components/ai-chat';
import { CommandPalette } from '@/components/ui/command-palette';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    // bg-[var(--color-legal-bg)]: Adım 1'de tanımlanan tema arka planı (light/dark/sepia)
    <div className="flex min-h-screen bg-[var(--color-legal-bg)]">
      {/* Global Ctrl+K command palette — tüm dashboard sayfalarında aktif */}
      <CommandPalette />

      <DashboardSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardHeader />
        <main className="flex-1 space-y-6 p-6">{children}</main>
      </div>

      {/* Sağ panel: AI sohbet — mevcut özellik korundu */}
      <div className="hidden w-[360px] border-l border-[var(--color-legal-border)] bg-[var(--color-legal-surface)] p-4 xl:block">
        <AiChat />
      </div>
    </div>
  );
}
