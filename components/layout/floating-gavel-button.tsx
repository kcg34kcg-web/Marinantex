'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Gavel } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GavelQuickActionsMenu, type GavelMenuPosition } from '@/components/layout/gavel-quick-actions-menu';

type Position = {
  x: number;
  y: number;
};

type DragState = {
  pointerId: number | null;
  startPointerX: number;
  startPointerY: number;
  startButtonX: number;
  startButtonY: number;
  hasDragged: boolean;
};

const FLOATING_GAVEL_STORAGE_KEY = 'babylexit_floating_gavel_position_v1';
const BUTTON_SIZE = 52;
const EDGE_GAP = 12;
const TOP_SAFE_AREA = 84;
const MOBILE_BOTTOM_SAFE_AREA = 92;
const DESKTOP_BOTTOM_SAFE_AREA = 20;
const DRAG_ACTIVATION_THRESHOLD = 6;
const MENU_GAP = 12;
const MENU_WIDTH = 280;
const MENU_HEIGHT = 178;

function getViewportBounds() {
  const bottomSafeArea = window.innerWidth < 768 ? MOBILE_BOTTOM_SAFE_AREA : DESKTOP_BOTTOM_SAFE_AREA;
  const minX = EDGE_GAP;
  const maxX = Math.max(minX, window.innerWidth - BUTTON_SIZE - EDGE_GAP);

  const minYCandidate = Math.max(EDGE_GAP, window.innerHeight - BUTTON_SIZE - bottomSafeArea);
  const minY = Math.min(TOP_SAFE_AREA, minYCandidate);
  const maxY = Math.max(minY, window.innerHeight - BUTTON_SIZE - bottomSafeArea);

  return { minX, maxX, minY, maxY, bottomSafeArea };
}

function clampPosition(position: Position): Position {
  const bounds = getViewportBounds();
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, position.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, position.y)),
  };
}

function getDefaultPosition(): Position {
  const bounds = getViewportBounds();
  return { x: bounds.maxX, y: bounds.maxY };
}

function getSnapToEdgePosition(position: Position): Position {
  const bounds = getViewportBounds();
  const midpoint = window.innerWidth / 2;
  const buttonCenterX = position.x + BUTTON_SIZE / 2;

  return {
    x: buttonCenterX <= midpoint ? bounds.minX : bounds.maxX,
    y: Math.min(bounds.maxY, Math.max(bounds.minY, position.y)),
  };
}

function readStoredPosition(): Position | null {
  try {
    const raw = localStorage.getItem(FLOATING_GAVEL_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<Position>;
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
      return null;
    }

    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return null;
    }

    return clampPosition({ x: parsed.x, y: parsed.y });
  } catch {
    return null;
  }
}

function persistPosition(position: Position) {
  try {
    localStorage.setItem(FLOATING_GAVEL_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // localStorage erişimi kısıtlıysa sessizce geç.
  }
}

export function FloatingGavelButton() {
  const pathname = usePathname();
  const router = useRouter();

  const isSocialRoute = pathname === '/social' || pathname.startsWith('/social/');
  const isHukukAiChatRoute = pathname === '/tools/hukuk-ai' || pathname.startsWith('/tools/hukuk-ai/');

  const [buttonPosition, setButtonPosition] = useState<Position | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const dragStateRef = useRef<DragState>({
    pointerId: null,
    startPointerX: 0,
    startPointerY: 0,
    startButtonX: 0,
    startButtonY: 0,
    hasDragged: false,
  });

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = 'floating-gavel-action-menu';

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setButtonPosition(readStoredPosition() ?? getDefaultPosition());
  }, []);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!buttonPosition) {
      return;
    }

    const handleResize = () => {
      setButtonPosition((current) => (current ? clampPosition(current) : current));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [buttonPosition]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handleOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsMenuOpen(false);
    };

    document.addEventListener('pointerdown', handleOutsideClick);
    return () => document.removeEventListener('pointerdown', handleOutsideClick);
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isMenuOpen]);

  const menuPosition = useMemo<GavelMenuPosition>(() => {
    if (!buttonPosition || typeof window === 'undefined') {
      return { top: TOP_SAFE_AREA, left: EDGE_GAP };
    }

    const bounds = getViewportBounds();
    let left = buttonPosition.x + BUTTON_SIZE + MENU_GAP;
    if (left + MENU_WIDTH > window.innerWidth - EDGE_GAP) {
      left = buttonPosition.x - MENU_WIDTH - MENU_GAP;
    }

    const maxLeft = Math.max(EDGE_GAP, window.innerWidth - MENU_WIDTH - EDGE_GAP);
    left = Math.min(maxLeft, Math.max(EDGE_GAP, left));

    let top = buttonPosition.y - 8;
    const maxTop = Math.max(TOP_SAFE_AREA, window.innerHeight - MENU_HEIGHT - bounds.bottomSafeArea);
    top = Math.min(maxTop, Math.max(TOP_SAFE_AREA, top));

    return { top, left };
  }, [buttonPosition]);

  if (isSocialRoute || !buttonPosition) {
    return null;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!buttonPosition) {
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const element = buttonRef.current;
    if (!element) {
      return;
    }

    element.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startButtonX: buttonPosition.x,
      startButtonY: buttonPosition.y,
      hasDragged: false,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragStateRef.current.startPointerX;
    const deltaY = event.clientY - dragStateRef.current.startPointerY;

    if (!dragStateRef.current.hasDragged) {
      const exceededThreshold = Math.abs(deltaX) >= DRAG_ACTIVATION_THRESHOLD || Math.abs(deltaY) >= DRAG_ACTIVATION_THRESHOLD;
      if (!exceededThreshold) {
        return;
      }
      dragStateRef.current.hasDragged = true;
      setIsDragging(true);
      setIsMenuOpen(false);
    }

    setButtonPosition(
      clampPosition({
        x: dragStateRef.current.startButtonX + deltaX,
        y: dragStateRef.current.startButtonY + deltaY,
      }),
    );
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    buttonRef.current?.releasePointerCapture(event.pointerId);
    const dragged = dragStateRef.current.hasDragged;
    dragStateRef.current.pointerId = null;
    dragStateRef.current.hasDragged = false;
    setIsDragging(false);

    if (dragged) {
      setButtonPosition((current) => {
        if (!current) {
          return current;
        }
        const snapped = getSnapToEdgePosition(current);
        persistPosition(snapped);
        return snapped;
      });
      return;
    }

    setIsMenuOpen((previous) => !previous);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    buttonRef.current?.releasePointerCapture(event.pointerId);
    dragStateRef.current.pointerId = null;
    dragStateRef.current.hasDragged = false;
    setIsDragging(false);
  }

  function handleKeyboardToggle(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsMenuOpen((previous) => !previous);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsMenuOpen(false);
    }
  }

  function handleGoToChat() {
    if (isHukukAiChatRoute) {
      setIsMenuOpen(false);
      return;
    }

    setIsMenuOpen(false);
    router.push('/tools/hukuk-ai');
  }

  function handleAddTask() {
    setIsMenuOpen(false);
    router.push('/dashboard/tasks?openTask=1');
  }

  return (
    <>
      <div
        className="group fixed z-40"
        style={{
          left: `${buttonPosition.x}px`,
          top: `${buttonPosition.y}px`,
        }}
      >
        <button
          ref={buttonRef}
          type="button"
          title="Hızlı hukuk aksiyonları"
          aria-label="Hızlı hukuk aksiyon menüsünü aç"
          aria-controls={menuId}
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          data-dragging={isDragging ? 'true' : 'false'}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onKeyDown={handleKeyboardToggle}
          className={cn(
            'touch-none rounded-2xl border p-3 text-[var(--primary)] backdrop-blur-md',
            'border-[color-mix(in_srgb,var(--main-border,var(--border)),var(--primary)_22%)]',
            'bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),white_8%)]',
            'shadow-[0_16px_32px_-20px_rgba(15,23,42,0.55)]',
            'transition-all duration-200 motion-reduce:transition-none',
            'hover:-translate-y-0.5 hover:shadow-[0_20px_34px_-22px_rgba(15,23,42,0.55)]',
            'active:translate-y-0 active:scale-95',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary),white_28%)]',
            'data-[dragging=true]:cursor-grabbing',
            !isDragging && 'cursor-grab',
          )}
        >
          <Gavel className={cn('h-5 w-5 transition-transform duration-150', isMenuOpen && 'rotate-[-8deg]')} />
        </button>

        <span
          className={cn(
            'pointer-events-none absolute -top-9 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border px-2.5 py-1 text-[11px] font-medium',
            'border-[var(--main-border,var(--border))]',
            'bg-[color-mix(in_srgb,var(--main-surface-2,var(--surface)),white_8%)] text-[var(--main-text,var(--text))]',
            'shadow-[0_12px_24px_-22px_rgba(15,23,42,0.55)]',
            'opacity-0 transition-all duration-200 group-hover:opacity-100 group-focus-within:opacity-100 md:block',
          )}
        >
          Hukuk hızlı menüsü
        </span>
      </div>

      <GavelQuickActionsMenu
        open={isMenuOpen}
        menuId={menuId}
        menuRef={menuRef}
        position={menuPosition}
        isChatPage={isHukukAiChatRoute}
        onGoToChat={handleGoToChat}
        onAddTask={handleAddTask}
      />
    </>
  );
}
