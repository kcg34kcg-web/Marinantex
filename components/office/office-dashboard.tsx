'use client';

import { useState } from 'react';
import { Bell, FileText, ShieldAlert, Users, Sparkles } from 'lucide-react';
import { OfficeNotificationFeed } from '@/components/office/office-notification-feed';
import { OfficeDocumentAnalyzeForm } from '@/components/office/office-document-analyze-form';
import { OfficeHmkConfirmForm } from '@/components/office/office-hmk-confirm-form';
import { OfficeTeamPanel } from './office-team-panel';
import { OfficeFeedPanel } from './office-feed-panel';
import { cn } from '@/lib/utils';

interface OfficeDashboardProps {
  activeRole: 'lawyer' | 'assistant';
  initialTab?: 'notifications' | 'team' | 'documents' | 'hmk' | 'feed';
}

type OfficeTab = 'notifications' | 'team' | 'documents' | 'hmk' | 'feed';

export function OfficeDashboard({ activeRole, initialTab }: OfficeDashboardProps) {
  const [activeTab, setActiveTab] = useState<OfficeTab>(initialTab ?? 'notifications');

  const roleLabel = activeRole === 'assistant' ? 'Asistan' : 'Avukat';

  const tabs: Array<{ id: OfficeTab; label: string; icon: typeof Bell }> = [
    { id: 'notifications', label: 'Operasyon', icon: Bell },
    { id: 'team', label: 'Ekip', icon: Users },
    { id: 'feed', label: 'Ana Akis', icon: Sparkles },
    { id: 'documents', label: 'Belgeler', icon: FileText },
    { id: 'hmk', label: 'HMK', icon: ShieldAlert },
  ];

  return (
    <div className="space-y-3">
      {/* Ust satir - daha sade */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Ofis Paneli</h2>
          <p className="text-xs text-slate-500">Operasyon ve belge akislarini yonetin.</p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {roleLabel}
        </div>
      </div>

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
                  onClick={() => setActiveTab(tab.id)}
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
          {activeTab === 'team' ? <OfficeTeamPanel activeRole={activeRole} /> : null}
          {activeTab === 'feed' ? <OfficeFeedPanel activeRole={activeRole} /> : null}
          {activeTab === 'documents' ? <OfficeDocumentAnalyzeForm activeRole={activeRole} /> : null}
          {activeTab === 'hmk' ? <OfficeHmkConfirmForm /> : null}
        </div>
      </div>
    </div>
  );
}