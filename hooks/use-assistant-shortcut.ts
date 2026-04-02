'use client';

import { useEffect } from 'react';

function normalizeShortcut(shortcut: string) {
  return shortcut
    .toLocaleLowerCase('tr-TR')
    .replace('ctrl', 'control')
    .replace('cmd', 'meta')
    .replace('mod', navigator.platform.toLowerCase().includes('mac') ? 'meta' : 'control');
}

function matchShortcut(event: KeyboardEvent, shortcut: string) {
  const normalized = normalizeShortcut(shortcut);
  const parts = normalized.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return false;
  }

  const keyPart = parts[parts.length - 1];
  const hasCtrl = parts.includes('control');
  const hasMeta = parts.includes('meta');
  const hasAlt = parts.includes('alt');
  const hasShift = parts.includes('shift');

  if (event.ctrlKey !== hasCtrl) return false;
  if (event.metaKey !== hasMeta) return false;
  if (event.altKey !== hasAlt) return false;
  if (event.shiftKey !== hasShift) return false;

  return event.key.toLocaleLowerCase('tr-TR') === keyPart;
}

export function useAssistantShortcut(shortcut: string, onTrigger: () => void) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (isTypingTarget) {
        return;
      }

      if (matchShortcut(event, shortcut)) {
        event.preventDefault();
        onTrigger();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onTrigger, shortcut]);
}
