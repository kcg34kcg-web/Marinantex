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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl',
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {title ? <h3 className="mb-3 text-base font-semibold text-[var(--text)]">{title}</h3> : null}
        {children}
      </div>
    </div>
  );
}
