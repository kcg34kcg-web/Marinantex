'use client';

import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type { AssistantMemoryItem } from '@/types/assistant';

const createSchema = z.object({
  content: z.string().min(1).max(800),
  kind: z.enum(['NOTE', 'PREFERENCE', 'FACT']),
});

type CreateValues = z.infer<typeof createSchema>;

interface MemoryPanelProps {
  items: AssistantMemoryItem[];
  loading?: boolean;
  onCreate: (payload: { content: string; kind: 'NOTE' | 'PREFERENCE' | 'FACT'; tags: string[] }) => void;
  onDelete: (id: string) => void;
}

export function MemoryPanel({ items, loading, onCreate, onDelete }: MemoryPanelProps) {
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      content: '',
      kind: 'NOTE',
    },
  });

  const submit = form.handleSubmit((values) => {
    onCreate({
      content: values.content.trim(),
      kind: values.kind,
      tags: [],
    });
    form.reset({
      content: '',
      kind: values.kind,
    });
  });

  return (
    <div className="space-y-3 p-3">
      <form onSubmit={submit} className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <select {...form.register('kind')} className="h-9 rounded-lg border border-[var(--main-border,var(--border))] bg-transparent px-2 text-xs">
            <option value="NOTE">Not</option>
            <option value="PREFERENCE">Tercih</option>
            <option value="FACT">Bilgi</option>
          </select>
          <input
            {...form.register('content')}
            placeholder="Hatırlanacak bilgi..."
            className="col-span-2 h-9 rounded-lg border border-[var(--main-border,var(--border))] bg-transparent px-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="h-8 rounded-lg border border-[var(--main-border,var(--border))] px-3 text-xs text-[var(--main-muted,var(--secondary))]"
        >
          Hafızaya ekle
        </button>
      </form>

      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-[var(--main-border,var(--border))] p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-[var(--main-muted,var(--secondary))]">{item.kind}</span>
              <button
                type="button"
                onClick={() => onDelete(item.id)}
                className="text-[10px] text-rose-600"
              >
                Unut
              </button>
            </div>
            <p className="text-sm text-[var(--main-text,var(--text))]">{item.content}</p>
          </div>
        ))}
        {items.length === 0 ? (
          <p className="text-xs text-[var(--main-muted,var(--secondary))]">Henüz hafıza kaydı yok.</p>
        ) : null}
      </div>
    </div>
  );
}
