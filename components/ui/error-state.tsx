import type { ReactNode } from 'react';

interface ErrorStateProps {
  message: string;
  action?: ReactNode;
}

export function ErrorState({ message, action }: ErrorStateProps) {
  return (
    <div className="rounded-2xl border border-[color-mix(in_srgb,var(--error),white_60%)] bg-[color-mix(in_srgb,var(--error),white_92%)] p-4">
      <p className="text-sm font-medium text-[var(--error)]">{message}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
