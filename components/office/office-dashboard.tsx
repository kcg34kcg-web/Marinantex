'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell, Users, Sparkles } from 'lucide-react';
import { OfficeNotificationFeed } from '@/components/office/office-notification-feed';
import { OfficeTeamPanel } from './office-team-panel';
import { OfficeFeedPanel } from './office-feed-panel';
import { cn } from '@/lib/utils';

interface OfficeDashboardProps {
  activeRole: 'lawyer' | 'assistant';
  initialTab?: 'notifications' | 'team' | 'feed';
  initialTeamThreadId?: string;
}

type OfficeTab = 'notifications' | 'team' | 'feed';

export function OfficeDashboard({ activeRole, initialTab, initialTeamThreadId }: OfficeDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabs: Array<{ id: OfficeTab; label: string; icon: typeof Bell }> = [
    { id: 'notifications', label: 'Operasyon', icon: Bell },
    { id: 'team', label: 'Ekip', icon: Users },
    { id: 'feed', label: 'Ana Akis', icon: Sparkles },
  ];

  const queryTab = searchParams.get('tab');
  const activeTab: OfficeTab =
    queryTab === 'notifications' || queryTab === 'team' || queryTab === 'feed'
      ? queryTab
      : initialTab ?? 'notifications';

  const handleTabChange = (tab: OfficeTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);

    if (tab !== 'team') {
      params.delete('threadId');
    }

    const nextQuery = params.toString();
    router.replace((nextQuery.length > 0 ? `${pathname}?${nextQuery}` : pathname) as never, { scroll: false });
  };

  return (
    <div className="space-y-3">
      {/* Sekmeler en ustte / asil odak */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="overflow-x-auto">
          <div className="flex min-w-max gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                    selected
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Icerik alani */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          {activeTab === 'notifications' ? <OfficeNotificationFeed /> : null}
          {activeTab === 'team' ? <OfficeTeamPanel activeRole={activeRole} initialThreadId={initialTeamThreadId} /> : null}
          {activeTab === 'feed' ? <OfficeFeedPanel activeRole={activeRole} /> : null}
        </div>
      </div>
    </div>
  );
}
