'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

type DialogContextValue = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
};

const DialogContext = React.createContext<DialogContextValue>({ open: false });

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open = false, onOpenChange, children }: DialogProps) {
  return <DialogContext.Provider value={{ open, onOpenChange }}>{children}</DialogContext.Provider>;
}

export function DialogTrigger({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function DialogPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

export function DialogOverlay({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { onOpenChange } = React.useContext(DialogContext);
  return (
    <div
      className={cn('fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]', className)}
      onClick={() => onOpenChange?.(false)}
      {...props}
    />
  );
}

export function DialogContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { open, onOpenChange } = React.useContext(DialogContext);
  if (!open) return null;

  return (
    <DialogPortal>
      <DialogOverlay />
      <div className="fixed inset-0 z-50 grid place-items-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          className={cn(
            'relative w-full max-w-lg rounded-[var(--radius-md)] border border-[var(--main-border,var(--border))]',
            'bg-[color-mix(in_srgb,var(--main-surface-3,var(--surface)),transparent_4%)] shadow-[var(--shadow-elev-3)] backdrop-blur-[var(--blur-heavy)]',
            'animate-fade-in-scale',
            className,
          )}
          {...props}
        >
          <button
            type="button"
            onClick={() => onOpenChange?.(false)}
            className="absolute right-3 top-3 rounded-[var(--radius-xs)] p-1.5 text-[var(--main-muted,var(--secondary))] transition-colors hover:bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),var(--primary)_10%)] hover:text-[var(--main-text,var(--text))]"
            aria-label="Close"
          >
            ×
          </button>
          {children}
        </div>
      </div>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-end gap-2', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-lg font-semibold tracking-[-0.01em] text-[var(--main-text,var(--text))]', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-[var(--main-muted,var(--secondary))]', className)} {...props} />;
}

export function DialogClose({ children }: { children: React.ReactNode }) {
  const { onOpenChange } = React.useContext(DialogContext);
  return (
    <button type="button" onClick={() => onOpenChange?.(false)}>
      {children}
    </button>
  );
}
