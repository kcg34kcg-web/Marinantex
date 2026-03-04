import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

// ── Temel Skeleton: spinner yerine iskelet (bekleme psikolojisi yönetimi) ────────────────────────
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg',
        'bg-slate-200 dark:bg-slate-700 sepia:bg-[#E8D5B5]',
        className,
      )}
      style={style}
    >
      <div className="absolute inset-0 animate-shimmer" />
    </div>
  );
}

// ── Hukuki belge yükleme şablonu ─────────────────────────────────────────────────────────────────
// Şeffaf Ajan yaklaşımı: yapıyı kurar, içi dolmayı bekler (sahte düşünme tiyatrosu YOK)
export function LegalDocumentSkeleton({ label }: { label?: string }) {
  return (
    <div className="w-full rounded-2xl border border-[var(--color-legal-border)] p-5 shadow-legal-sm space-y-4 bg-[var(--color-legal-surface)]">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-2.5 w-1/3" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-5/6" />
        <Skeleton className="h-2.5 w-4/6" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Skeleton className="h-2 col-span-3" />
        <Skeleton className="h-2 col-span-1" />
      </div>
      {label && (
        <p className="text-xs text-[var(--color-legal-text-secondary,_var(--muted-foreground))] animate-pulse">
          {label}
        </p>
      )}
    </div>
  );
}
