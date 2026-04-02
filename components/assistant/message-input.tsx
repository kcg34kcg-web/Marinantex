'use client';

import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Mic, Paperclip, SendHorizontal } from 'lucide-react';

const formSchema = z.object({
  message: z.string().min(1).max(4000),
});

type FormValues = z.infer<typeof formSchema>;

interface MessageInputProps {
  disabled?: boolean;
  placeholder?: string;
  onSubmit: (message: string) => void;
  onVoiceClick: () => void;
}

export function MessageInput({ disabled, placeholder, onSubmit, onVoiceClick }: MessageInputProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      message: '',
    },
  });

  const submit = form.handleSubmit((values) => {
    const message = values.message.trim();
    if (!message) {
      return;
    }
    onSubmit(message);
    form.reset({ message: '' });
  });

  return (
    <form onSubmit={submit} className="border-t border-[var(--main-border,var(--border))] px-3 pb-3 pt-2">
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--main-border,var(--border))] px-2 text-xs text-[var(--main-muted,var(--secondary))] hover:text-[var(--main-text,var(--text))] disabled:opacity-60"
          title="Ek dosya (ilk sürümde metin tabanlı)"
          aria-label="Ek dosya"
        >
          <Paperclip className="h-3.5 w-3.5" />
          <span>Ek</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={onVoiceClick}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--main-border,var(--border))] px-2 text-xs text-[var(--main-muted,var(--secondary))] hover:text-[var(--main-text,var(--text))] disabled:opacity-60"
          title="Sesli giriş"
          aria-label="Sesli giriş"
        >
          <Mic className="h-3.5 w-3.5" />
          <span>Ses</span>
        </button>
      </div>

      <div className="flex items-end gap-2">
        <textarea
          {...form.register('message')}
          rows={2}
          maxLength={4000}
          disabled={disabled}
          placeholder={placeholder ?? 'Mesajını yaz...'}
          className="min-h-16 flex-1 resize-none rounded-xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] px-3 py-2 text-sm text-[var(--main-text,var(--text))] outline-none transition-colors focus:border-[color-mix(in_srgb,var(--primary),white_30%)]"
        />
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--primary),white_35%)] bg-[color-mix(in_srgb,var(--primary),white_85%)] text-[var(--primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--primary),white_78%)] disabled:opacity-60"
          title="Gönder"
          aria-label="Gönder"
        >
          <SendHorizontal className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
