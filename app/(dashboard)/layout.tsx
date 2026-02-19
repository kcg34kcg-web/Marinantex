import { DashboardHeader } from '@/components/layout/dashboard-header';
import { DashboardSidebar } from '@/components/layout/dashboard-sidebar';
import { AiChat } from '@/components/ai-chat';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white">
      <DashboardSidebar />
      <div className="flex-1">
        <DashboardHeader />
        <main className="space-y-6 p-6">{children}</main>
      </div>
      <div className="hidden w-[360px] border-l border-border bg-slate-50 p-4 xl:block">
        <AiChat />
      </div>
    </div>
  );
}
