'use client';

import { useEffect, useState, useTransition } from 'react';
import { Loader2, Send } from 'lucide-react';
import { markMessagesAsRead, sendMessage } from '@/app/actions/chat';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type Message = {
  id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
  signedUrl?: string;
  media_type?: string | null;
};

interface ChatWindowProps {
  conversationId: string;
  initialMessages: Message[];
  currentUser: { id: string };
}

export default function ChatWindow({ conversationId, initialMessages, currentUser }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [draft, setDraft] = useState('');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    void markMessagesAsRead(conversationId);
  }, [conversationId]);

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;

    const optimistic: Message = {
      id: crypto.randomUUID(),
      sender_id: currentUser.id,
      content: trimmed,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimistic]);
    setDraft('');

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append('conversationId', conversationId);
        formData.append('content', trimmed);
        const persisted = await sendMessage(formData);
        setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? (persisted as Message) : m)));
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(trimmed);
      }
    });
  };

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">Konuşma</p>
        <p className="text-xs text-slate-500">{conversationId}</p>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">Henüz mesaj yok.</p>
        ) : (
          messages.map((message) => {
            const mine = message.sender_id === currentUser.id;
            return (
              <div key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm',
                    mine ? 'bg-slate-900 text-white' : 'bg-white text-slate-800 border border-slate-200',
                  )}
                >
                  {message.content}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder="Mesaj yaz..."
            className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
            disabled={isPending}
          />
          <Button onClick={handleSend} disabled={isPending || !draft.trim()} size="icon" aria-label="Send message">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
