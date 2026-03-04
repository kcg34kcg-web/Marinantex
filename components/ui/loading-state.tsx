interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Yukleniyor...' }: LoadingStateProps) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="h-2 w-28 animate-pulse rounded bg-[color-mix(in_srgb,var(--primary),white_75%)]" />
      <p className="mt-3 text-sm text-[var(--secondary)]">{message}</p>
    </div>
  );
}
