import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_4%)] p-6 text-center">
      <p className="text-sm font-semibold text-[var(--main-text,var(--text))]">{title}</p>
      {description ? <p className="mt-1 text-sm text-[var(--main-muted,var(--secondary))]">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
