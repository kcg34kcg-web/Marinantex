import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'w-full max-w-2xl rounded-[var(--radius-md)] border border-[var(--main-border,var(--border))]',
          'bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_4%)] p-5 shadow-[var(--shadow-elev-3)] backdrop-blur-[var(--blur-heavy)]',
          'animate-fade-in-scale',
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {title ? <h3 className="mb-3 text-base font-semibold text-[var(--main-text,var(--text))]">{title}</h3> : null}
        {children}
      </div>
    </div>
  );
}
