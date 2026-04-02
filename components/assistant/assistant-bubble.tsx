'use client';

import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Logo } from '@/components/brand/Logo';
import { cn } from '@/lib/utils';
import type { AssistantBubbleState } from '@/types/assistant';

interface AssistantBubbleProps {
  x: number;
  y: number;
  size: number;
  state: AssistantBubbleState;
  animationLevel: number;
  unreadCount: number;
  isOpen: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onToggle: () => void;
}

function getStateClass(state: AssistantBubbleState) {
  if (state === 'thinking') return 'text-amber-600';
  if (state === 'working') return 'text-blue-600';
  if (state === 'needs_confirmation') return 'text-orange-600';
  if (state === 'success') return 'text-emerald-600';
  if (state === 'error') return 'text-rose-600';
  if (state === 'listening') return 'text-indigo-600';
  return 'text-[var(--primary)]';
}

function getRingClass(state: AssistantBubbleState) {
  if (state === 'thinking') return 'border-amber-400/80 bg-amber-100/35';
  if (state === 'working') return 'border-blue-400/80 bg-blue-100/35';
  if (state === 'needs_confirmation') return 'border-orange-400/80 bg-orange-100/35';
  if (state === 'success') return 'border-emerald-400/80 bg-emerald-100/35';
  if (state === 'error') return 'border-rose-400/80 bg-rose-100/35';
  if (state === 'listening') return 'border-indigo-400/80 bg-indigo-100/35';
  return 'border-[color-mix(in_srgb,var(--primary),white_34%)] bg-[color-mix(in_srgb,var(--primary),white_88%)]';
}

function getStateLabel(state: AssistantBubbleState) {
  if (state === 'thinking') return 'Asistan düşünüyor';
  if (state === 'working') return 'Asistan işlem yapıyor';
  if (state === 'needs_confirmation') return 'Asistan onay bekliyor';
  if (state === 'success') return 'Asistan işlemi tamamladı';
  if (state === 'error') return 'Asistan hata verdi';
  if (state === 'listening') return 'Asistan dinliyor';
  return 'Asistan hazır';
}

export function AssistantBubble({ x, y, size, state, animationLevel, unreadCount, isOpen, onPointerDown, onToggle }: AssistantBubbleProps) {
  const label = getStateLabel(state);
  const isAnimated = animationLevel > 0;
  const pulse =
    animationLevel >= 3
      ? 'animate-pulse'
      : animationLevel === 2
      ? 'animate-[pulse_2.2s_ease-in-out_infinite]'
      : animationLevel === 1
      ? 'animate-[pulse_4s_ease-in-out_infinite]'
      : '';

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      className="fixed z-50"
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
    >
      <button
        type="button"
        onPointerDown={onPointerDown}
        onKeyDown={handleKeyDown}
        title={label}
        aria-label={label}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className={cn(
          'group relative grid touch-none place-items-center rounded-xl bg-transparent transition-transform duration-200',
          'cursor-grab active:cursor-grabbing',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary),white_30%)]',
          'hover:scale-[1.04] active:scale-[0.97]',
          getStateClass(state),
        )}
        style={{
          width: `${size}px`,
          height: `${size}px`,
        }}
      >
        <span
          className={cn(
            'pointer-events-none absolute inset-0 rounded-[1.1rem] border transition-colors duration-200',
            getRingClass(state),
            isAnimated && pulse,
          )}
        />
        <Logo
          iconOnly
          width={Math.max(40, Math.floor(size * 0.78))}
          height={Math.max(40, Math.floor(size * 0.78))}
          className={cn(
            'pointer-events-none drop-shadow-[0_8px_18px_rgba(15,23,42,0.28)] transition-transform duration-200',
            isOpen ? 'scale-[1.07]' : 'scale-100',
            (state === 'thinking' || state === 'working') && 'translate-y-[-1px]',
          )}
        />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
