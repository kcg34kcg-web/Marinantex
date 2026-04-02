'use client';

import { Plus, X, ArrowUpRight, Activity, Brain, MessageCircle, Settings2 } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { ActivityTimeline } from '@/components/assistant/activity-timeline';
import { ConfirmationDialog } from '@/components/assistant/confirmation-dialog';
import { MemoryPanel } from '@/components/assistant/memory-panel';
import { MessageInput } from '@/components/assistant/message-input';
import { MessageList } from '@/components/assistant/message-list';
import { QuickActions } from '@/components/assistant/quick-actions';
import { SettingsPanel } from '@/components/assistant/settings-panel';
import { LiveOperationTimeline } from '@/components/assistant/live-operation-timeline';
import { cn } from '@/lib/utils';
import type {
  AssistantAuditLogItem,
  AssistantLiveTimelineItem,
  AssistantConversationSummary,
  AssistantMemoryItem,
  AssistantMessageItem,
  AssistantPendingAction,
  AssistantPreferencePayload,
  AssistantQuickActionItem,
} from '@/types/assistant';
import type { AssistantPanelTab } from '@/store/assistant-store';

interface AssistantPanelProps {
  open: boolean;
  assistantName: string;
  statusLabel: string;
  isTyping: boolean;
  userName: string;
  conversations: AssistantConversationSummary[];
  activeConversationId: string | null;
  messages: AssistantMessageItem[];
  quickActions: AssistantQuickActionItem[];
  liveTimeline: AssistantLiveTimelineItem[];
  memoryItems: AssistantMemoryItem[];
  auditLogs: AssistantAuditLogItem[];
  preference: AssistantPreferencePayload | null;
  pendingAction: AssistantPendingAction | null;
  confirmingAction: boolean;
  savingPreferences: boolean;
  loadingMemory: boolean;
  tab: AssistantPanelTab;
  onClose: () => void;
  onSetTab: (tab: AssistantPanelTab) => void;
  onNewConversation: () => void;
  onConversationSelect: (id: string) => void;
  onQuickAction: (item: AssistantQuickActionItem) => void;
  onSendMessage: (message: string) => void;
  onVoiceClick: () => void;
  onPreferenceSave: (next: AssistantPreferencePayload) => void;
  onMemoryCreate: (payload: { content: string; kind: 'NOTE' | 'PREFERENCE' | 'FACT'; tags: string[] }) => void;
  onMemoryDelete: (id: string) => void;
  onPendingCancel: () => void;
  onPendingConfirm: () => void;
  onGoTasks: () => void;
  onGoHukukAi: () => void;
}

const tabs: Array<{ id: AssistantPanelTab; label: string; icon: typeof MessageCircle }> = [
  { id: 'chat', label: 'Sohbet', icon: MessageCircle },
  { id: 'memory', label: 'Hafıza', icon: Brain },
  { id: 'activity', label: 'İşlemler', icon: Activity },
  { id: 'settings', label: 'Ayarlar', icon: Settings2 },
];

export function AssistantPanel({
  open,
  assistantName,
  statusLabel,
  isTyping,
  userName,
  conversations,
  activeConversationId,
  messages,
  quickActions,
  liveTimeline,
  memoryItems,
  auditLogs,
  preference,
  pendingAction,
  confirmingAction,
  savingPreferences,
  loadingMemory,
  tab,
  onClose,
  onSetTab,
  onNewConversation,
  onConversationSelect,
  onQuickAction,
  onSendMessage,
  onVoiceClick,
  onPreferenceSave,
  onMemoryCreate,
  onMemoryDelete,
  onPendingCancel,
  onPendingConfirm,
  onGoTasks,
  onGoHukukAi,
}: AssistantPanelProps) {
  return (
    <div
      className={cn(
        'fixed bottom-24 right-3 z-50 w-[min(96vw,430px)] overflow-hidden rounded-3xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-1,var(--surface))] shadow-[0_28px_80px_-38px_rgba(15,23,42,0.5)] transition-all duration-200 md:right-4',
        open ? 'pointer-events-auto opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-3',
      )}
      role="dialog"
      aria-modal="false"
      aria-label="Yapay zeka asistanı"
    >
      <div className="flex items-center justify-between border-b border-[var(--main-border,var(--border))] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Logo iconOnly width={36} height={36} className="h-8 w-8" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--main-text,var(--text))]">{assistantName}</p>
            <p className="truncate text-[11px] text-[var(--main-muted,var(--secondary))]">{statusLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onGoHukukAi}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--main-border,var(--border))] px-2 text-[11px] text-[var(--main-muted,var(--secondary))]"
          >
            Hukuk-AI
            <ArrowUpRight className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--main-border,var(--border))] text-[var(--main-muted,var(--secondary))]"
            aria-label="Asistanı kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="border-b border-[var(--main-border,var(--border))] px-3 py-2">
        <div className="flex items-center gap-2">
          <select
            value={activeConversationId ?? ''}
            onChange={(event) => onConversationSelect(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--main-border,var(--border))] bg-transparent px-2 text-xs"
          >
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onNewConversation}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--main-border,var(--border))] px-2 text-xs text-[var(--main-muted,var(--secondary))]"
          >
            <Plus className="h-3.5 w-3.5" />
            Yeni
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSetTab(item.id)}
                className={cn(
                  'inline-flex h-8 items-center gap-1 rounded-full border px-2 text-xs transition-colors',
                  tab === item.id
                    ? 'border-[color-mix(in_srgb,var(--primary),white_35%)] bg-[color-mix(in_srgb,var(--primary),white_86%)] text-[var(--primary)]'
                    : 'border-[var(--main-border,var(--border))] text-[var(--main-muted,var(--secondary))]',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'chat' ? (
        <>
          <QuickActions items={quickActions} onSelect={onQuickAction} disabled={isTyping} />
          <LiveOperationTimeline items={liveTimeline} />

          <div className="h-[min(50vh,360px)] border-y border-[var(--main-border,var(--border))]">
            <MessageList messages={messages} isTyping={isTyping} assistantName={assistantName} userName={userName} />
          </div>

          <div className="flex items-center justify-between px-3 pt-2 text-[11px] text-[var(--main-muted,var(--secondary))]">
            <span>Kontrol sende, kritik işlemler onaysız çalışmaz.</span>
            <button type="button" onClick={onGoTasks} className="underline-offset-2 hover:underline">
              Görev ekle
            </button>
          </div>

          <MessageInput onSubmit={onSendMessage} onVoiceClick={onVoiceClick} disabled={isTyping} />
        </>
      ) : null}

      {tab === 'memory' ? (
        <MemoryPanel items={memoryItems} onCreate={onMemoryCreate} onDelete={onMemoryDelete} loading={loadingMemory} />
      ) : null}

      {tab === 'activity' ? <ActivityTimeline items={auditLogs} /> : null}

      {tab === 'settings' ? (
        <SettingsPanel preference={preference} onSave={onPreferenceSave} saving={savingPreferences} />
      ) : null}

      <ConfirmationDialog
        open={Boolean(pendingAction)}
        action={pendingAction}
        loading={confirmingAction}
        onCancel={onPendingCancel}
        onConfirm={onPendingConfirm}
      />
    </div>
  );
}
