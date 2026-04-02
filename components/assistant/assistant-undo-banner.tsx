'use client';

interface AssistantUndoBannerProps {
  label: string;
  secondsLeft: number;
  onUndo: () => void;
  onDismiss: () => void;
}

export function AssistantUndoBanner({ label, secondsLeft, onUndo, onDismiss }: AssistantUndoBannerProps) {
  return (
    <div className="fixed bottom-4 right-4 z-[70] max-w-[320px] rounded-xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] p-3 shadow-[0_20px_40px_-30px_rgba(15,23,42,0.6)]">
      <p className="text-xs text-[var(--main-text,var(--text))]">{label}</p>
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="text-[11px] text-[var(--main-muted,var(--secondary))]">{secondsLeft}s</span>
        <button
          type="button"
          onClick={onUndo}
          className="rounded-md border border-[color-mix(in_srgb,var(--primary),white_40%)] bg-[color-mix(in_srgb,var(--primary),white_88%)] px-2 py-1 text-[11px] font-semibold text-[var(--primary)]"
        >
          Geri Al
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-[var(--main-border,var(--border))] px-2 py-1 text-[11px] text-[var(--main-muted,var(--secondary))]"
        >
          Kapat
        </button>
      </div>
    </div>
  );
}
