"use client";

import { useChat } from 'ai/react';
import { Bot, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AiChat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
  });

  return (
    <section className="rounded-xl border border-border bg-white">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Bot className="h-4 w-4 text-blue-600" />
        <h2 className="text-sm font-semibold text-slate-900">Dijital İkiz Asistanı</h2>
      </header>

      <div className="h-64 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-500">Henüz mesaj yok. Bir hukuki soru sorarak başlayabilirsiniz.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="rounded-md border border-border p-3 text-sm">
              <p className="mb-1 font-medium text-slate-700">{message.role === 'user' ? 'Siz' : 'Asistan'}</p>
              <p className="text-slate-800">{message.content}</p>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-3">
        <Input
          name="prompt"
          placeholder="Örn: Bu dosyada bir sonraki adım ne olmalı?"
          value={input}
          onChange={handleInputChange}
        />
        <Button type="submit" variant="accent" disabled={isLoading}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </section>
  );
}
