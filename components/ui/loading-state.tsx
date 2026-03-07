interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Yukleniyor...' }: LoadingStateProps) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_4%)] p-6 shadow-[var(--shadow-elev-0)]">
      <div className="h-2 w-28 animate-pulse rounded bg-[color-mix(in_srgb,var(--primary),white_75%)]" />
      <p className="mt-3 text-sm text-[var(--main-muted,var(--secondary))]">{message}</p>
    </div>
  );
}
