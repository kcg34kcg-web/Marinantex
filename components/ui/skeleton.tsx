import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

// ── Temel Skeleton: spinner yerine iskelet (bekleme psikolojisi yönetimi) ────────────────────────
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg',
        'bg-[color-mix(in_srgb,var(--main-border,var(--border)),white_20%)]',
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
    <div className="w-full space-y-4 rounded-[var(--radius-md)] border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_4%)] p-5 shadow-[var(--shadow-elev-0)]">
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
        <p className="animate-pulse text-xs text-[var(--main-muted,var(--secondary))]">
          {label}
        </p>
      )}
    </div>
  );
}
