'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type { AssistantPreferencePayload } from '@/types/assistant';

const settingsSchema = z.object({
  assistantName: z.string().min(2).max(60),
  tone: z.enum(['professional', 'warm', 'short', 'detailed']),
  language: z.enum(['tr', 'en']),
  responseLength: z.enum(['short', 'detailed']),
  proactiveLevel: z.number().int().min(0).max(3),
  quietHoursStart: z.number().int().min(0).max(23),
  quietHoursEnd: z.number().int().min(0).max(23),
  keyboardShortcut: z.string().min(2).max(24),
  bubbleSize: z.number().int().min(44).max(128),
  animationLevel: z.number().int().min(0).max(3),
  memoryEnabled: z.boolean(),
  requireConfirmationCritical: z.boolean(),
  temporaryMode: z.boolean(),
});

type SettingsValues = z.infer<typeof settingsSchema>;

interface SettingsPanelProps {
  preference: AssistantPreferencePayload | null;
  saving?: boolean;
  onSave: (next: AssistantPreferencePayload) => void;
}

export function SettingsPanel({ preference, saving, onSave }: SettingsPanelProps) {
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: preference ?? undefined,
  });

  useEffect(() => {
    if (preference) {
      form.reset(preference);
    }
  }, [form, preference]);

  if (!preference) {
    return null;
  }

  const submit = form.handleSubmit((values) => {
    onSave({
      ...preference,
      ...values,
    });
  });

  return (
    <form onSubmit={submit} className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 space-y-1 text-xs">
          <span className="text-[var(--main-muted,var(--secondary))]">Asistan adı</span>
          <input {...form.register('assistantName')} className="h-9 w-full rounded-lg border border-[var(--main-border,var(--border))] bg-transparent px-2 text-sm" />
        </label>

        <label className="space-y-1 text-xs">
          <span className="text-[var(--main-muted,var(--secondary))]">Dil</span>
          <select {...form.register('language')} className="h-9 w-full rounded-lg border border-[var(--main-border,var(--border))] bg-transparent px-2 text-sm">
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="text-[var(--main-muted,var(--secondary))]">Ton</span>
          <select {...form.register('tone')} className="h-9 w-full rounded-lg border border-[var(--main-border,var(--border))] bg-transparent px-2 text-sm">
            <option value="professional">Profesyonel</option>
            <option value="warm">Sıcak</option>
            <option value="short">Kısa</option>
            <option value="detailed">Detaylı</option>
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="text-[var(--main-muted,var(--secondary))]">Yanıt uzunluğu</span>
          <select {...form.register('responseLength')} className="h-9 w-full rounded-lg border border-[var(--main-border,var(--border))] bg-transparent px-2 text-sm">
            <option value="short">Kısa</option>
            <option value="detailed">Detaylı</option>
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="text-[var(--main-muted,var(--secondary))]">Kısayol</span>
          <input {...form.register('keyboardShortcut')} className="h-9 w-full rounded-lg border border-[var(--main-border,var(--border))] bg-transparent px-2 text-sm" />
        </label>

        <label className="space-y-1 text-xs">
          <span className="text-[var(--main-muted,var(--secondary))]">Balon boyutu</span>
          <input
            type="number"
            min={44}
            max={128}
            {...form.register('bubbleSize', { valueAsNumber: true })}
            className="h-9 w-full rounded-lg border border-[var(--main-border,var(--border))] bg-transparent px-2 text-sm"
          />
        </label>

        <label className="space-y-1 text-xs">
          <span className="text-[var(--main-muted,var(--secondary))]">Proaktif seviye</span>
          <select
            {...form.register('proactiveLevel', { valueAsNumber: true })}
            className="h-9 w-full rounded-lg border border-[var(--main-border,var(--border))] bg-transparent px-2 text-sm"
          >
            <option value={0}>Kapalı</option>
            <option value={1}>Düşük</option>
            <option value={2}>Orta</option>
            <option value={3}>Yüksek</option>
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="text-[var(--main-muted,var(--secondary))]">Animasyon profili</span>
          <select
            {...form.register('animationLevel', { valueAsNumber: true })}
            className="h-9 w-full rounded-lg border border-[var(--main-border,var(--border))] bg-transparent px-2 text-sm"
          >
            <option value={0}>Sakin</option>
            <option value={1}>Düşük</option>
            <option value={2}>Orta</option>
            <option value={3}>Canlı</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs">
          <span className="text-[var(--main-muted,var(--secondary))]">Sessiz saat başlangıcı</span>
          <input
            type="number"
            min={0}
            max={23}
            {...form.register('quietHoursStart', { valueAsNumber: true })}
            className="h-9 w-full rounded-lg border border-[var(--main-border,var(--border))] bg-transparent px-2 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-[var(--main-muted,var(--secondary))]">Sessiz saat bitişi</span>
          <input
            type="number"
            min={0}
            max={23}
            {...form.register('quietHoursEnd', { valueAsNumber: true })}
            className="h-9 w-full rounded-lg border border-[var(--main-border,var(--border))] bg-transparent px-2 text-sm"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" {...form.register('memoryEnabled')} />
          <span>Hafıza açık</span>
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" {...form.register('requireConfirmationCritical')} />
          <span>Kritik işlemde onay iste</span>
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" {...form.register('temporaryMode')} />
          <span>Geçici sohbet modu</span>
        </label>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="h-9 w-full rounded-lg border border-[color-mix(in_srgb,var(--primary),white_35%)] bg-[color-mix(in_srgb,var(--primary),white_84%)] text-sm font-semibold text-[var(--primary)] disabled:opacity-70"
      >
        {saving ? 'Kaydediliyor...' : 'Ayarları kaydet'}
      </button>
    </form>
  );
}
