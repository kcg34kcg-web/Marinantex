'use client';

import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { ArrowRight, Bot, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type GavelMenuPosition = {
  top: number;
  left: number;
};

interface GavelQuickActionsMenuProps {
  open: boolean;
  menuId: string;
  menuRef: RefObject<HTMLDivElement | null>;
  position: GavelMenuPosition;
  isChatPage: boolean;
  onGoToChat: () => void;
  onAddTask: () => void;
}

export function GavelQuickActionsMenu({
  open,
  menuId,
  menuRef,
  position,
  isChatPage,
  onGoToChat,
  onAddTask,
}: GavelQuickActionsMenuProps) {
  const chatActionRef = useRef<HTMLButtonElement>(null);
  const taskActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const target = isChatPage ? taskActionRef.current : chatActionRef.current;
    window.requestAnimationFrame(() => target?.focus());
  }, [isChatPage, open]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    event.preventDefault();
    const actions = [chatActionRef.current, taskActionRef.current].filter(
      (button): button is HTMLButtonElement => button instanceof HTMLButtonElement && !button.disabled
    );

    if (actions.length === 0) {
      return;
    }

    const currentIndex = actions.findIndex((button) => button === document.activeElement);
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + actions.length) % actions.length;
    actions[nextIndex]?.focus();
  }

  return (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label="Tokmak hızlı aksiyon menüsü"
      aria-hidden={!open}
      onKeyDown={handleMenuKeyDown}
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      className={cn(
        'fixed z-40 w-[17.5rem] rounded-2xl border p-2.5 backdrop-blur-md',
        'border-[var(--main-border,var(--border))]',
        'bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),white_6%)]',
        'shadow-[0_22px_46px_-28px_rgba(15,23,42,0.45)]',
        'origin-top-left transition-all duration-200 ease-out motion-reduce:transition-none',
        open ? 'pointer-events-auto translate-y-0 scale-100 opacity-100' : 'pointer-events-none -translate-y-1 scale-95 opacity-0',
      )}
    >
      <p className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--main-muted,var(--secondary))]">
        Hızlı Aksiyonlar
      </p>

      <div className="space-y-2">
        <button
          ref={chatActionRef}
          type="button"
          role="menuitem"
          disabled={isChatPage}
          onClick={onGoToChat}
          className={cn(
            'group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary),white_30%)]',
            isChatPage
              ? [
                  'cursor-not-allowed border-[color-mix(in_srgb,var(--main-border,var(--border)),black_5%)]',
                  'bg-[color-mix(in_srgb,var(--main-surface-1,var(--surface)),black_3%)] text-[var(--main-muted,var(--secondary))]',
                ]
              : [
                  'border-[color-mix(in_srgb,var(--main-border,var(--border)),white_8%)]',
                  'bg-[color-mix(in_srgb,var(--main-surface-1,var(--surface)),white_5%)]',
                  'text-[var(--main-text,var(--text))]',
                  'hover:border-[color-mix(in_srgb,var(--primary),white_25%)] hover:bg-[color-mix(in_srgb,var(--primary),transparent_90%)]',
                  'active:scale-[0.99]',
                ],
          )}
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--primary),white_35%)] bg-[color-mix(in_srgb,var(--primary),white_86%)] text-[var(--primary)]">
            <Bot className="h-4 w-4" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {isChatPage ? 'Zaten bu sayfadasınız' : 'Hukuk AI Chat sayfasına git'}
            </span>
            <span className="block truncate text-[11px] text-[var(--main-muted,var(--secondary))]">
              {isChatPage ? 'Chat ekranı aktif durumda.' : 'Hızlı şekilde AI sohbet ekranını açın.'}
            </span>
          </span>

          {!isChatPage ? <ArrowRight className="h-4 w-4 text-[var(--main-muted,var(--secondary))]" /> : null}
        </button>

        <button
          ref={taskActionRef}
          type="button"
          role="menuitem"
          onClick={onAddTask}
          className={cn(
            'group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all duration-150',
            'border-[color-mix(in_srgb,var(--main-border,var(--border)),white_8%)]',
            'bg-[color-mix(in_srgb,var(--main-surface-1,var(--surface)),white_5%)]',
            'text-[var(--main-text,var(--text))]',
            'hover:border-[color-mix(in_srgb,var(--accent),white_18%)] hover:bg-[color-mix(in_srgb,var(--accent),transparent_88%)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent),white_24%)]',
            'active:scale-[0.99]',
          )}
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--accent),white_20%)] bg-[color-mix(in_srgb,var(--accent),white_82%)] text-[var(--accent)]">
            <Plus className="h-4 w-4" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">Görev ekle</span>
            <span className="block truncate text-[11px] text-[var(--main-muted,var(--secondary))]">
              Hızlı görev oluşturma penceresini açın.
            </span>
          </span>

          <ArrowRight className="h-4 w-4 text-[var(--main-muted,var(--secondary))]" />
        </button>
      </div>
    </div>
  );
}
