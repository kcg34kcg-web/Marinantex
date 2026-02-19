'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, FileText, ShieldAlert, Users, ArrowRight, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OfficeNotificationFeed } from '@/components/office/office-notification-feed';
import { OfficeDocumentAnalyzeForm } from '@/components/office/office-document-analyze-form';
import { OfficeHmkConfirmForm } from '@/components/office/office-hmk-confirm-form';
import { OfficeTeamPanel } from './office-team-panel';
import { cn } from '@/lib/utils';

interface OfficeDashboardProps {
  activeRole: 'lawyer' | 'assistant';
  initialTab?: 'notifications' | 'team' | 'documents' | 'hmk';
}

export function OfficeDashboard({ activeRole, initialTab }: OfficeDashboardProps) {
  const [activeTab, setActiveTab] = useState<'notifications' | 'team' | 'documents' | 'hmk'>(initialTab ?? 'notifications');
  const roleTitle = activeRole === 'assistant' ? 'Asistan Operasyon Görünümü' : 'Avukat Operasyon Görünümü';

  const { data: liveSummary } = useQuery<
    {
      summary: {
        pendingTasks: number;
        dueTodayTasks: number;
        unreadMessages: number;
        unreadThreads: number;
        documentsToday: number;
      };
    },
    Error
  >({
    queryKey: ['office', 'overview'],
    queryFn: async () => {
      const response = await fetch('/api/office/overview', { cache: 'no-store' });
      const payload = (await response.json()) as {
        summary?: {
          pendingTasks: number;
          dueTodayTasks: number;
          unreadMessages: number;
          unreadThreads: number;
          documentsToday: number;
        };
        error?: string;
      };

      if (!response.ok || !payload.summary) {
        throw new Error(payload.error ?? 'Office özet verisi alınamadı.');
      }

      return { summary: payload.summary };
    },
    refetchInterval: 15000,
    staleTime: 5000,
  });

  const summary = liveSummary?.summary ?? {
    pendingTasks: 0,
    dueTodayTasks: 0,
    unreadMessages: 0,
    unreadThreads: 0,
    documentsToday: 0,
  };
  const focusText =
    activeRole === 'assistant'
      ? 'Önce operasyon akışını temizleyin, sonra ekip mesajlarını göreve dönüştürün.'
      : 'Önce kritik süreleri doğrulayın, ardından dosya stratejisini ekip görevlerine dağıtın.';

  const highlights =
    activeRole === 'assistant'
      ? [
          { label: 'Birincil Odak', value: 'Takip + Evrak + Mesaj' },
          { label: 'Bekleyen İş', value: 'Belge akışı ve dönüşler' },
          { label: 'Risk Uyarısı', value: 'Cevapsız görevler' },
        ]
      : [
          { label: 'Birincil Odak', value: 'Süre + Karar + Müvekkil' },
          { label: 'Bekleyen İş', value: 'HMK onayı ve kritik inceleme' },
          { label: 'Risk Uyarısı', value: 'Süre yaklaşan dosyalar' },
        ];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-white to-slate-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700">
              <Sparkles className="h-3.5 w-3.5" />
              Office Odak Paneli
            </div>
            <h2 className="text-2xl font-semibold text-slate-900">Ofisim</h2>
            <p className="text-sm text-slate-600">Daha az karmaşa, daha net öncelik, daha hızlı aksiyon.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant="blue">{roleTitle}</Badge>
            <p className="text-xs text-slate-500">{new Date().toLocaleString('tr-TR')}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {highlights.map((item) => (
          <div key={item.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</p>
            <p className="mt-1 text-sm font-medium text-slate-800">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Bugün Ne Yapmalıyım?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-700">{focusText}</p>
            <ul className="space-y-2 text-sm text-slate-700">
              <li>• Önce Operasyon sekmesini temizleyin.</li>
              <li>• Sonra Ekip sekmesinde görev dağıtın.</li>
              <li>• Belgeler ve HMK adımlarını kapanışta tamamlayın.</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => setActiveTab('notifications')}>
                Operasyona Git <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setActiveTab('team')}>
                Ekibe Git
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hızlı Durum</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <p className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><Bell className="h-4 w-4" /> Okunmamış mesaj</span><span className="font-semibold">{summary.unreadMessages}</span></p>
            <p className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><Users className="h-4 w-4" /> Okunmamış sohbet</span><span className="font-semibold">{summary.unreadThreads}</span></p>
            <p className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><FileText className="h-4 w-4" /> Bugün işlenen belge</span><span className="font-semibold">{summary.documentsToday}</span></p>
            <p className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Bugün vadesi gelen görev</span><span className="font-semibold">{summary.dueTodayTasks}</span></p>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 text-slate-100">
          <CardHeader>
            <CardTitle className="text-base text-slate-100">Gün Sonu Hedefi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-200">
            <p>• Bekleyen görev: <span className="font-semibold">{summary.pendingTasks}</span></p>
            <p>• Bugün vadesi gelen: <span className="font-semibold">{summary.dueTodayTasks}</span></p>
            <p>• Okunmamış mesaj: <span className="font-semibold">{summary.unreadMessages}</span></p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-2 md:grid-cols-4">
          {[
            { id: 'notifications', label: 'Operasyon', icon: Bell, hint: 'Canlı akış' },
            { id: 'team', label: 'Ekip', icon: Users, hint: 'Sohbet merkezi' },
            { id: 'documents', label: 'Belgeler', icon: FileText, hint: 'OCR + işleme' },
            { id: 'hmk', label: 'HMK', icon: ShieldAlert, hint: 'Süre onayı' },
          ].map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as 'notifications' | 'team' | 'documents' | 'hmk')}
                className={cn(
                  'rounded-xl border px-3 py-3 text-left transition-all duration-200',
                  selected
                    ? 'border-blue-300 bg-blue-50 text-blue-900 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:bg-slate-50'
                )}
              >
                <div className="mb-2 flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-medium">{tab.label}</span>
                </div>
                <p className="text-xs opacity-80">{tab.hint}</p>
              </button>
            );
          })}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          {activeTab === 'notifications' ? <OfficeNotificationFeed /> : null}
          {activeTab === 'team' ? <OfficeTeamPanel activeRole={activeRole} /> : null}
          {activeTab === 'documents' ? <OfficeDocumentAnalyzeForm activeRole={activeRole} /> : null}
          {activeTab === 'hmk' ? <OfficeHmkConfirmForm /> : null}
        </div>
      </div>
    </div>
  );
}
