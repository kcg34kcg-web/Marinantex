'use client';

import { Command, Mail, Search, Sparkles, SquarePen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CommandWheelItem {
  key: string;
  label: string;
  quickActionKey: string;
  prompt: string;
}

interface AssistantCommandWheelProps {
  open: boolean;
  x: number;
  y: number;
  bubbleSize: number;
  onSelect: (item: CommandWheelItem) => void;
  onClose: () => void;
}

const WHEEL_ITEMS: Array<CommandWheelItem & { angleDeg: number; icon: 'mail' | 'task' | 'summary' | 'file' }> = [
  {
    key: 'wheel_mail',
    label: 'Mail aç',
    quickActionKey: 'open_mail_page',
    prompt: 'Mail sayfasını aç',
    angleDeg: -90,
    icon: 'mail',
  },
  {
    key: 'wheel_task',
    label: 'Görev ekle',
    quickActionKey: 'new_task',
    prompt: 'Yeni görev oluştur',
    angleDeg: 0,
    icon: 'task',
  },
  {
    key: 'wheel_summary',
    label: 'Bugünü özetle',
    quickActionKey: 'today_summary',
    prompt: 'Bugünü özetle',
    angleDeg: 180,
    icon: 'summary',
  },
  {
    key: 'wheel_file',
    label: 'Dosya bul',
    quickActionKey: 'find_file',
    prompt: 'Dosya bul',
    angleDeg: 90,
    icon: 'file',
  },
];

function iconFor(name: 'mail' | 'task' | 'summary' | 'file') {
  if (name === 'mail') return Mail;
  if (name === 'task') return SquarePen;
  if (name === 'summary') return Sparkles;
  return Search;
}

export function AssistantCommandWheel({ open, x, y, bubbleSize, onSelect, onClose }: AssistantCommandWheelProps) {
  if (!open) {
    return null;
  }

  const centerX = x + bubbleSize / 2;
  const centerY = y + bubbleSize / 2;
  const radius = Math.max(66, bubbleSize * 1.1);

  return (
    <div
      className="fixed inset-0 z-[60] pointer-events-auto"
      onPointerDown={onClose}
      role="presentation"
    >
      <div
        className="absolute rounded-full border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))]/95 shadow-[0_18px_40px_-26px_rgba(15,23,42,0.45)] backdrop-blur-sm"
        style={{
          left: `${centerX - radius}px`,
          top: `${centerY - radius}px`,
          width: `${radius * 2}px`,
          height: `${radius * 2}px`,
        }}
      />
      {WHEEL_ITEMS.map((item) => {
        const radians = (item.angleDeg * Math.PI) / 180;
        const itemX = centerX + Math.cos(radians) * radius - 32;
        const itemY = centerY + Math.sin(radians) * radius - 18;
        const Icon = iconFor(item.icon);

        return (
          <button
            key={item.key}
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={() => onSelect(item)}
            className={cn(
              'pointer-events-auto absolute inline-flex h-9 min-w-[64px] items-center justify-center gap-1 rounded-full border',
              'border-[color-mix(in_srgb,var(--primary),white_35%)] bg-[color-mix(in_srgb,var(--primary),white_86%)]',
              'px-3 text-[11px] font-semibold text-[var(--primary)] shadow-[0_10px_22px_-16px_rgba(15,23,42,0.6)]',
            )}
            style={{
              left: `${itemX}px`,
              top: `${itemY}px`,
            }}
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        );
      })}

      <div
        className="pointer-events-none absolute inline-flex items-center gap-1 rounded-full border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] px-2 py-1 text-[10px] text-[var(--main-muted,var(--secondary))]"
        style={{
          left: `${centerX - 42}px`,
          top: `${centerY - 12}px`,
        }}
      >
        <Command className="h-3 w-3" />
        Hızlı Komut
      </div>
    </div>
  );
}
