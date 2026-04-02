'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { AssistantMessageItem } from '@/types/assistant';

interface MessageListProps {
  messages: AssistantMessageItem[];
  isTyping: boolean;
  assistantName: string;
  userName: string;
}

export function MessageList({ messages, isTyping, assistantName, userName }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [isTyping, messages]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-3 py-3">
      {messages.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-1,var(--surface)),white_8%)] p-4 text-sm text-[var(--main-muted,var(--secondary))]">
          Merhaba. Buradan görev oluşturabilir, dosya aratabilir ve ofis aksiyonlarını güvenli onayla çalıştırabilirsin.
        </div>
      ) : null}

      {messages.map((message) => {
        const isUser = message.role === 'user';
        return (
          <div
            key={message.id}
            className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
            aria-label={isUser ? userName : assistantName}
          >
            <div
              className={cn(
                'max-w-[86%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                isUser
                  ? 'bg-[color-mix(in_srgb,var(--primary),white_84%)] text-[var(--main-text,var(--text))]'
                  : 'border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] text-[var(--main-text,var(--text))]',
              )}
            >
              {message.content}
            </div>
          </div>
        );
      })}

      {isTyping ? (
        <div className="flex justify-start">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] px-3 py-1 text-xs text-[var(--main-muted,var(--secondary))]">
            <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            <span>Asistan yazıyor</span>
          </div>
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}
